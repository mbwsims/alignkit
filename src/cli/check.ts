import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { discoverInstructionFiles, parseInstructionFile } from '../parsers/auto-detect.js';
import { readSessions } from '../sessions/session-reader.js';
import { verifySession } from '../verifiers/verifier-engine.js';
import { verifyWithLLM } from '../verifiers/llm-judge.js';
import { HistoryStore } from '../history/store.js';
import type { Observation } from '../verifiers/types.js';
import type { SerializedObservation, SessionResult } from '../history/types.js';
import type { Rule } from '../parsers/types.js';

const ANALYSIS_VERSION = '0.1.0';

function serializeObservation(obs: Observation): SerializedObservation {
  return {
    ruleId: obs.ruleId,
    sessionId: obs.sessionId,
    relevant: obs.relevant,
    followed: obs.relevant ? obs.followed : null,
    method: obs.method,
    confidence: obs.confidence,
  };
}

function getFileSince(filePath: string, cwd: string): Date {
  // Try git log for last commit date of file
  try {
    const result = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', filePath],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (result) {
      return new Date(result);
    }
  } catch {
    // Not a git repo or git not available
  }

  // Fall back to file mtime
  const stat = statSync(filePath);
  return new Date(stat.mtimeMs);
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

interface RuleAdherence {
  rule: Rule;
  relevantCount: number;
  totalSessions: number;
  followedCount: number;
  adherence: number | null;
  topConfidence: string;
  topMethod: string;
}

function aggregateObservations(
  rules: Rule[],
  allResults: SessionResult[],
): RuleAdherence[] {
  return rules.map((rule) => {
    let relevantCount = 0;
    let followedCount = 0;
    let topConfidence = 'low';
    let topMethod = 'unmapped';

    const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

    for (const result of allResults) {
      for (const obs of result.observations) {
        if (obs.ruleId !== rule.id) continue;
        if (obs.relevant) {
          relevantCount++;
          if (obs.followed === true) {
            followedCount++;
          }
          if ((confidenceRank[obs.confidence] ?? 0) > (confidenceRank[topConfidence] ?? 0)) {
            topConfidence = obs.confidence;
          }
          topMethod = obs.method;
        }
      }
    }

    return {
      rule,
      relevantCount,
      totalSessions: allResults.length,
      followedCount,
      adherence: relevantCount > 0 ? followedCount / relevantCount : null,
      topConfidence,
      topMethod,
    };
  });
}

function formatTerminalOutput(
  filePath: string,
  sinceDate: Date,
  sessionCount: number,
  adherenceData: RuleAdherence[],
): string {
  const lines: string[] = [];

  lines.push(pc.cyan(`Auto-detected: ./${filePath}`));
  lines.push(`${filePath} last modified: ${formatTimeAgo(sinceDate)}`);
  lines.push(`Found ${sessionCount} sessions since then.`);
  lines.push('');
  lines.push(pc.bold('RULE ADHERENCE:'));
  lines.push('');

  // Table header
  const cols = {
    rule: 40,
    sessions: 10,
    followed: 10,
    adherence: 11,
    confidence: 12,
    method: 22,
  };

  const header =
    ' ' +
    'Rule'.padEnd(cols.rule) +
    'Sessions'.padEnd(cols.sessions) +
    'Followed'.padEnd(cols.followed) +
    'Adherence'.padEnd(cols.adherence) +
    'Confidence'.padEnd(cols.confidence) +
    'Method';

  lines.push(header);
  lines.push(' ' + '\u2500'.repeat(cols.rule + cols.sessions + cols.followed + cols.adherence + cols.confidence + cols.method));

  let autoVerified = 0;
  let unverifiable = 0;
  let needsCustom = 0;

  for (const item of adherenceData) {
    const ruleText =
      item.rule.text.length > cols.rule - 4
        ? '"' + item.rule.text.slice(0, cols.rule - 5) + '…"'
        : '"' + item.rule.text + '"';

    const sessionsStr = `${item.relevantCount}/${item.totalSessions}`;

    let followedStr: string;
    let adherenceStr: string;

    if (item.relevantCount === 0) {
      followedStr = '-';
      adherenceStr = '-';
    } else {
      followedStr = `${item.followedCount}/${item.relevantCount}`;
      const pct = Math.round((item.adherence ?? 0) * 100);
      const icon = pct === 100 ? pc.green(' \u2713') : pct >= 80 ? pc.yellow(' ~') : pc.red(' \u2717');
      adherenceStr = `${pct}%${icon}`;
    }

    if (item.topMethod === 'unmapped') {
      if (item.rule.verifiability === 'unverifiable') {
        unverifiable++;
      } else {
        needsCustom++;
      }
    } else {
      autoVerified++;
    }

    lines.push(
      ' ' +
        ruleText.padEnd(cols.rule) +
        sessionsStr.padEnd(cols.sessions) +
        followedStr.padEnd(cols.followed) +
        adherenceStr.padEnd(cols.adherence) +
        item.topConfidence.padEnd(cols.confidence) +
        item.topMethod,
    );
  }

  lines.push('');

  const summary: string[] = [];
  if (autoVerified > 0) summary.push(`${autoVerified} rules auto-verified`);
  if (unverifiable > 0) summary.push(`${unverifiable} unverifiable`);
  if (needsCustom > 0) summary.push(`${needsCustom} needs custom check`);
  if (summary.length > 0) {
    lines.push(' ' + summary.join(' \u00B7 '));
  }

  return lines.join('\n');
}

function formatJsonOutput(
  filePath: string,
  sinceDate: Date,
  sessionCount: number,
  adherenceData: RuleAdherence[],
): string {
  return JSON.stringify({
    file: filePath,
    since: sinceDate.toISOString(),
    sessionCount,
    rules: adherenceData.map((item) => ({
      ruleId: item.rule.id,
      text: item.rule.text,
      relevantSessions: item.relevantCount,
      totalSessions: item.totalSessions,
      followedCount: item.followedCount,
      adherence: item.adherence,
      confidence: item.topConfidence,
      method: item.topMethod,
    })),
  });
}

function formatMarkdownOutput(
  filePath: string,
  sinceDate: Date,
  sessionCount: number,
  adherenceData: RuleAdherence[],
): string {
  const lines: string[] = [];

  lines.push(`# Rule Adherence: ${filePath}`);
  lines.push('');
  lines.push(`Last modified: ${formatTimeAgo(sinceDate)}`);
  lines.push(`Sessions analyzed: ${sessionCount}`);
  lines.push('');
  lines.push('| Rule | Sessions | Followed | Adherence | Confidence | Method |');
  lines.push('|------|----------|----------|-----------|------------|--------|');

  for (const item of adherenceData) {
    const ruleText = item.rule.text.length > 50
      ? item.rule.text.slice(0, 49) + '...'
      : item.rule.text;
    const sessionsStr = `${item.relevantCount}/${item.totalSessions}`;
    const followedStr = item.relevantCount === 0 ? '-' : `${item.followedCount}/${item.relevantCount}`;
    const adherenceStr = item.adherence !== null ? `${Math.round(item.adherence * 100)}%` : '-';

    lines.push(`| ${ruleText} | ${sessionsStr} | ${followedStr} | ${adherenceStr} | ${item.topConfidence} | ${item.topMethod} |`);
  }

  return lines.join('\n');
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check [file]')
    .description('Check rule adherence against Claude Code session history')
    .option('--fresh', 'Re-parse all sessions (ignore history cache)')
    .option('--deep', 'Use LLM to evaluate unverifiable rules (~$0.05/session, requires ANTHROPIC_API_KEY)')
    .option('--no-deep', 'Skip LLM evaluation even if API key is available')
    .option('--format <format>', 'Output format: terminal, json, markdown', 'terminal')
    .action(async (file: string | undefined, options: { fresh?: boolean; deep?: boolean; format: string }) => {
      const cwd = process.cwd();

      // 1. Auto-discover instruction file
      let filePath: string;
      let relPath: string;

      if (file) {
        filePath = path.resolve(cwd, file);
        relPath = path.relative(cwd, filePath);
      } else {
        const discovered = discoverInstructionFiles(cwd);
        if (discovered.length === 0) {
          console.error('Error: No instruction files found.');
          process.exit(1);
        }
        filePath = discovered[0].absolutePath;
        relPath = discovered[0].relativePath;
      }

      // 2. Parse into Rule[]
      const content = readFileSync(filePath, 'utf-8');
      const rules = parseInstructionFile(content, filePath);

      // 3. Compute rulesVersion hash
      const rulesVersion = HistoryStore.computeRulesVersion(filePath);

      // 4. Determine since date
      const sinceDate = getFileSince(filePath, cwd);

      // 5. Read sessions
      const sessions = readSessions({ cwd, since: sinceDate });

      // 6. Load history store
      const alignkitDir = path.join(cwd, '.alignkit');
      const store = new HistoryStore(alignkitDir);

      // 7. Process sessions
      let processedCount = 0;
      let totalUnresolved = 0;
      let totalAutoVerified = 0;

      for (const session of sessions) {
        if (!options.fresh && store.hasSession(session.sessionId)) {
          continue;
        }

        // When --fresh, remove old entry before re-appending
        if (options.fresh && store.hasSession(session.sessionId)) {
          store.removeSession(session.sessionId);
        }

        let observations = verifySession(rules, session.actions, session.sessionId);

        // Identify rules that auto-verification couldn't resolve
        const needsLLMIds = new Set(
          observations
            .filter((o) => o.method === 'unmapped' || !o.relevant)
            .map((o) => o.ruleId),
        );
        const unresolvedRules = rules.filter((r) => needsLLMIds.has(r.id));

        // LLM evaluation: run if --deep was explicitly passed
        if (options.deep && unresolvedRules.length > 0) {
          if (process.env.ANTHROPIC_API_KEY) {
            const llmObservations = await verifyWithLLM(
              unresolvedRules,
              session.actions,
              session.sessionId,
            );

            if (llmObservations.length > 0) {
              const llmRuleIds = new Set(llmObservations.map((o) => o.ruleId));
              observations = [
                ...observations.filter((o) => !llmRuleIds.has(o.ruleId)),
                ...llmObservations,
              ];
            }
          } else {
            process.stderr.write(
              pc.yellow('Warning: --deep requires ANTHROPIC_API_KEY. Skipping LLM evaluation.\n'),
            );
          }
        }

        // Track unresolved count for the nudge message after output
        if (!options.deep && unresolvedRules.length > 0) {
          totalUnresolved = unresolvedRules.length;
          totalAutoVerified = rules.length - unresolvedRules.length;
        }

        const result: SessionResult = {
          sessionId: session.sessionId,
          timestamp: session.timestamp,
          rulesVersion,
          analysisVersion: ANALYSIS_VERSION,
          observations: observations.map(serializeObservation),
        };

        store.append(result);
        processedCount++;
      }

      // 8. Aggregate observations for current epoch
      const allResults = store.queryByEpoch(rulesVersion);
      const adherenceData = aggregateObservations(rules, allResults);

      // 9. Output results
      const totalSessions = allResults.length;

      switch (options.format) {
        case 'json':
          console.log(formatJsonOutput(relPath, sinceDate, totalSessions, adherenceData));
          break;
        case 'markdown':
          console.log(formatMarkdownOutput(relPath, sinceDate, totalSessions, adherenceData));
          break;
        default:
          console.log(formatTerminalOutput(relPath, sinceDate, totalSessions, adherenceData));
          break;
      }

      // Nudge: if there are unresolved rules and --deep wasn't used, suggest it
      if (!options.deep && totalUnresolved > 0 && options.format === 'terminal') {
        console.log('');
        if (process.env.ANTHROPIC_API_KEY) {
          console.log(
            pc.dim(`  Auto-verification covered ${totalAutoVerified}/${rules.length} rules. `) +
            pc.cyan(`Run with --deep to verify the remaining ${totalUnresolved} with LLM analysis (~$0.05/session).`),
          );
        } else {
          console.log(
            pc.dim(`  Auto-verification covered ${totalAutoVerified}/${rules.length} rules. `) +
            pc.cyan(`Set ANTHROPIC_API_KEY and run with --deep to verify the remaining ${totalUnresolved} (~$0.05/session).`),
          );
        }
      }
    });
}
