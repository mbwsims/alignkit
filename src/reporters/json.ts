import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from './types.js';

export class JsonReporter implements Reporter {
  report(result: LintResult): string {
    const diagnostics = result.rules.flatMap((rule) =>
      rule.diagnostics.map((d) => ({
        ...d,
        ruleSlug: rule.slug,
        ruleText: rule.text,
      }))
    );

    const rules = result.rules.map((rule) => ({
      id: rule.id,
      slug: rule.slug,
      text: rule.text,
      category: rule.category,
      verifiability: rule.verifiability,
      source: rule.source,
      applicability: rule.applicability
        ? {
            kind: rule.applicability.kind,
            patterns: rule.applicability.patterns,
            source: rule.applicability.source,
          }
        : undefined,
      diagnosticCount: rule.diagnostics.length,
    }));

    const output: Record<string, unknown> = {
      file: result.file,
      ruleCount: result.rules.length,
      tokenAnalysis: result.tokenAnalysis,
      diagnostics,
      rules,
      discoveredFiles: result.discoveredFiles,
    };

    if (result.deepAnalysis !== undefined) {
      output.deepAnalysis = result.deepAnalysis;
    }

    return JSON.stringify(output, null, 2);
  }
}
