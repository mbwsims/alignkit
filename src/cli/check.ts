import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { discoverInstructionTargets } from '../parsers/auto-detect.js';
import { loadEffectiveInstructionGraph } from '../parsers/instruction-loader.js';
import { readSessions } from '../sessions/session-reader.js';
import { verifySession } from '../verifiers/verifier-engine.js';
import { verifyWithLLM } from '../verifiers/llm-judge.js';
import { aggregateAdherence } from '../check/adherence.js';
import { ANALYSIS_VERSION } from '../history/analysis-version.js';
import { HistoryStore } from '../history/store.js';
import { serializeObservation } from '../verifiers/types.js';
import type { SessionResult } from '../history/types.js';
import { createDeepSpinner } from './spinner.js';

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

function getGraphSince(filePaths: string[], cwd: string): Date {
  return filePaths.reduce((latest, filePath) => {
    const candidate = getFileSince(filePath, cwd);
    return candidate.getTime() > latest.getTime() ? candidate : latest;
  }, new Date(0));
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatTerminalOutput(
  filePath: string,
  sinceDate: Date,
  sessionCount: number,
  adherenceData: ReturnType<typeof aggregateAdherence>,
  usedDeep = false,
): string {
  const lines: string[] = [];

  lines.push(pc.cyan(`Auto-detected: ./${filePath}`));
  lines.push(`${filePath} last modified: ${formatTimeAgo(sinceDate)}`);
  lines.push(`Found ${sessionCount} sessions since then.`);
  lines.push('');
  lines.push(pc.bold('RULE ADHERENCE:'));
  lines.push('');

  // If no rules were exercised in any session, skip the table entirely
  const allUnexercised = adherenceData.every((item) => item.relevantCount === 0);
  if (allUnexercised && adherenceData.length > 0) {
    lines.push(`  ${adherenceData.length} rules tracked. None were exercised in ${sessionCount} session${sessionCount === 1 ? '' : 's'}.`);
    lines.push('');
    if (usedDeep) {
      lines.push(pc.dim('  Even with LLM analysis, no rule activity was found. More sessions will produce data.'));
    } else {
      lines.push(pc.dim('  More sessions will produce data, or use --deep for LLM-based verification.'));
    }
    return lines.join('\n');
  }

  // Table header
  const cols = {
    rule: 34,
    sessions: 10,
    resolved: 10,
    followed: 10,
    adherence: 11,
    confidence: 12,
    method: 22,
  };

  const header =
    ' ' +
    'Rule'.padEnd(cols.rule) +
    'Sessions'.padEnd(cols.sessions) +
    'Resolved'.padEnd(cols.resolved) +
    'Followed'.padEnd(cols.followed) +
    'Adherence'.padEnd(cols.adherence) +
    'Confidence'.padEnd(cols.confidence) +
    'Method';

  lines.push(header);
  lines.push(' ' + '\u2500'.repeat(cols.rule + cols.sessions + cols.resolved + cols.followed + cols.adherence + cols.confidence + cols.method));

  let autoEvaluated = 0;
  let llmEvaluated = 0;
  let unverifiable = 0;
  let needsCustom = 0;
  let notExercised = 0;
  let inconclusive = 0;

  for (const item of adherenceData) {
    const ruleText =
      item.rule.text.length > cols.rule - 4
        ? '"' + item.rule.text.slice(0, cols.rule - 5) + '…"'
        : '"' + item.rule.text + '"';

    const sessionsStr = `${item.relevantCount}/${item.totalSessions}`;
    const resolvedStr = item.relevantCount === 0 ? '-' : `${item.resolvedCount}/${item.relevantCount}`;

    let followedStr: string;
    let adherenceStr: string;

    if (item.relevantCount === 0) {
      followedStr = '-';
      adherenceStr = '-'.padEnd(cols.adherence);
      notExercised++;
    } else if (item.resolvedCount === 0) {
      followedStr = '-';
      adherenceStr = '?'.padEnd(cols.adherence);
      inconclusive++;
    } else {
      followedStr = `${item.followedCount}/${item.resolvedCount}`;
      const pct = Math.round((item.adherence ?? 0) * 100);
      const pctStr = `${pct}%`;
      const icon = pct === 100 ? pc.green('\u2713') : pct >= 80 ? pc.yellow('~') : pc.red('\u2717');
      // Pad the plain text first, then append the colored icon
      // so ANSI escape codes don't throw off column alignment
      adherenceStr = `${pctStr.padEnd(cols.adherence - 2)}${icon} `;
    }

    if (item.relevantCount === 0) {
      // not exercised in any relevant session; don't count this as verified/evaluated
    } else if (item.resolvedCount === 0) {
      // relevant but unresolved; don't count as verified/evaluated
    } else if (item.method === 'unmapped') {
      if (item.rule.verifiability === 'unverifiable') {
        unverifiable++;
      } else {
        needsCustom++;
      }
    } else if (item.method === 'llm-judge') {
      llmEvaluated++;
    } else {
      autoEvaluated++;
    }

    lines.push(
      ' ' +
        ruleText.padEnd(cols.rule) +
        sessionsStr.padEnd(cols.sessions) +
        resolvedStr.padEnd(cols.resolved) +
        followedStr.padEnd(cols.followed) +
        adherenceStr +
        item.confidence.padEnd(cols.confidence) +
        item.method,
    );
  }

  lines.push('');

  const summary: string[] = [];
  if (autoEvaluated > 0) summary.push(`${autoEvaluated} rules auto-evaluated`);
  if (llmEvaluated > 0) summary.push(`${llmEvaluated} rules LLM-evaluated`);
  if (unverifiable > 0) summary.push(`${unverifiable} unverifiable`);
  if (needsCustom > 0) summary.push(`${needsCustom} needs custom check`);
  if (notExercised > 0) summary.push(`${notExercised} not exercised`);
  if (inconclusive > 0) summary.push(`${inconclusive} inconclusive`);
  if (summary.length > 0) {
    lines.push(' ' + summary.join(' \u00B7 '));
  }

  return lines.join('\n');
}

function formatJsonOutput(
  filePath: string,
  sinceDate: Date,
  sessionCount: number,
  adherenceData: ReturnType<typeof aggregateAdherence>,
): string {
  return JSON.stringify({
    file: filePath,
    since: sinceDate.toISOString(),
    sessionCount,
    rules: adherenceData.map((item) => ({
      ruleId: item.rule.id,
      text: item.rule.text,
      relevantSessions: item.relevantCount,
      resolvedSessions: item.resolvedCount,
      inconclusiveSessions: item.inconclusiveCount,
      totalSessions: item.totalSessions,
      followedCount: item.followedCount,
      adherence: item.adherence,
      confidence: item.confidence,
      confidenceReason: item.confidenceReason,
      method: item.method,
      evidence: item.evidence,
    })),
  });
}

function formatMarkdownOutput(
  filePath: string,
  sinceDate: Date,
  sessionCount: number,
  adherenceData: ReturnType<typeof aggregateAdherence>,
): string {
  const lines: string[] = [];

  lines.push(`# Rule Adherence: ${filePath}`);
  lines.push('');
  lines.push(`Last modified: ${formatTimeAgo(sinceDate)}`);
  lines.push(`Sessions analyzed: ${sessionCount}`);
  lines.push('');
  lines.push('| Rule | Sessions | Resolved | Followed | Adherence | Confidence | Method | Evidence |');
  lines.push('|------|----------|----------|----------|-----------|------------|--------|----------|');

  for (const item of adherenceData) {
    const ruleText = item.rule.text.length > 50
      ? item.rule.text.slice(0, 49) + '...'
      : item.rule.text;
    const sessionsStr = `${item.relevantCount}/${item.totalSessions}`;
    const resolvedStr = item.relevantCount === 0 ? '-' : `${item.resolvedCount}/${item.relevantCount}`;
    const followedStr = item.resolvedCount === 0 ? '-' : `${item.followedCount}/${item.resolvedCount}`;
    const adherenceStr = item.adherence !== null ? `${Math.round(item.adherence * 100)}%` : '-';
    const evidence = item.evidence
      ? item.evidence.replace(/\|/g, '\\|').slice(0, 80)
      : '—';

    lines.push(`| ${ruleText} | ${sessionsStr} | ${resolvedStr} | ${followedStr} | ${adherenceStr} | ${item.confidence} | ${item.method} | ${evidence} |`);
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
    .option('--since-days <days>', 'Analyze sessions from the last N days (overrides file modification date)')
    .option('--format <format>', 'Output format: terminal, json, markdown', 'terminal')
    .action(async (file: string | undefined, options: { fresh?: boolean; deep?: boolean; sinceDays?: string; format: string }) => {
      const cwd = process.cwd();

      // 1. Auto-discover instruction file
      let filePath: string;
      let relPath: string;

      if (file) {
        filePath = path.resolve(cwd, file);
        relPath = path.relative(cwd, filePath);
      } else {
        const discovered = discoverInstructionTargets(cwd);
        if (discovered.length === 0) {
          console.error('No instruction files found. Run `alignkit init` to create one.');
          process.exit(1);
        }
        filePath = discovered[0].absolutePath;
        relPath = discovered[0].relativePath;
      }

      // 2. Parse into Rule[]
      const graph = loadEffectiveInstructionGraph(filePath, cwd);
      const rules = graph.rules;

      // 3. Compute rulesVersion hash
      const rulesVersion = graph.graphHash;

      // 4. Determine since date
      let sinceDate: Date;
      if (options.sinceDays !== undefined) {
        const days = parseInt(options.sinceDays, 10);
        sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      } else {
        sinceDate = getGraphSince(graph.loadedFiles, cwd);
      }

      // 5. Read sessions
      const sessions = readSessions({ cwd, since: sinceDate });

      // 6. Load history store
      const alignkitDir = path.join(cwd, '.alignkit');
      const store = new HistoryStore(alignkitDir);

      // 7. Process sessions
      let processedCount = 0;
      let totalUnresolved = 0;
      let totalAutoVerified = 0;
      let unresolvedRuleNames: string[] = [];

      for (const session of sessions) {
        const alreadyCached = store.hasSession(session.sessionId, rulesVersion, ANALYSIS_VERSION);

        // Skip if already cached, unless:
        // - --fresh was passed (reprocess everything)
        // - --deep was passed and the cached session has no LLM observations (upgrade it)
        if (alreadyCached && !options.fresh) {
          if (options.deep) {
            // Check if cached session already has LLM observations
            const cached = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION)
              .find((r) => r.sessionId === session.sessionId);
            const hasLLM = cached?.observations.some((o) => o.method === 'llm-judge');
            if (hasLLM) continue; // already deep-verified, skip
            // Otherwise, reprocess with LLM
            store.removeSession(session.sessionId, rulesVersion, ANALYSIS_VERSION);
          } else {
            continue;
          }
        }

        // When --fresh, remove old entry before re-appending
        if (alreadyCached && options.fresh) {
          store.removeSession(session.sessionId, rulesVersion, ANALYSIS_VERSION);
        }

        let observations = verifySession(rules, session.actions, session.sessionId, cwd);

        // Identify rules that auto-verification couldn't resolve
        const needsLLMIds = new Set(
          observations
            .filter((o) => o.method === 'unmapped' || (!o.relevant && o.method !== 'scope:filtered'))
            .map((o) => o.ruleId),
        );
        const unresolvedRules = rules.filter((r) => needsLLMIds.has(r.id));

        // LLM evaluation: run if --deep was explicitly passed
        if (options.deep && unresolvedRules.length > 0) {
          if (process.env.ANTHROPIC_API_KEY) {
            const spinner = options.format === 'terminal'
              ? createDeepSpinner()
              : null;
            try {
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
              spinner?.succeed(`Deep analysis complete (session ${processedCount + 1}/${sessions.length})`);
            } catch (err) {
              spinner?.fail('Deep analysis failed');
              throw err;
            }
          } else {
            process.stderr.write(
              pc.yellow('Warning: --deep requires ANTHROPIC_API_KEY. Skipping LLM evaluation.\n'),
            );
          }
        }

        // Track unresolved rules for the nudge message after output
        if (!options.deep && unresolvedRules.length > 0) {
          totalUnresolved = unresolvedRules.length;
          totalAutoVerified = rules.length - unresolvedRules.length;
          unresolvedRuleNames = unresolvedRules.map((r) =>
            r.text.length > 40 ? r.text.slice(0, 39) + '…' : r.text,
          );
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
      const allResults = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);
      const adherenceData = aggregateAdherence(rules, allResults);

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
          console.log(formatTerminalOutput(relPath, sinceDate, totalSessions, adherenceData, !!options.deep));
          break;
      }

      // Compute unresolved rules from final adherence data (not just from this run)
      if (totalUnresolved === 0 && !options.deep) {
        const unresolvedFromData = adherenceData.filter(
          (d) => d.method === 'unmapped'
        );
        if (unresolvedFromData.length > 0) {
          totalUnresolved = unresolvedFromData.length;
          totalAutoVerified = adherenceData.length - unresolvedFromData.length;
          unresolvedRuleNames = unresolvedFromData.map((d) =>
            d.rule.text.length > 40 ? d.rule.text.slice(0, 39) + '…' : d.rule.text,
          );
        }
      }

      // Nudge: if there are unresolved rules and --deep wasn't used, suggest it
      if (!options.deep && totalUnresolved > 0 && options.format === 'terminal') {
        console.log('');
        // Show which rules couldn't be verified
        const ruleList = unresolvedRuleNames.slice(0, 3).map((n) => `"${n}"`).join(', ');
        const more = totalUnresolved > 3 ? ` + ${totalUnresolved - 3} more` : '';
        console.log(pc.dim(`  ${totalUnresolved} unresolved: ${ruleList}${more}`));

        if (process.env.ANTHROPIC_API_KEY) {
          console.log(
            pc.cyan(`  Run with --deep to verify these with LLM analysis (~$0.05/session).`),
          );
        } else {
          console.log(
            pc.cyan(`  Set ANTHROPIC_API_KEY and run with --deep to verify (~$0.05/session).`),
          );
        }
      }
    });
}
