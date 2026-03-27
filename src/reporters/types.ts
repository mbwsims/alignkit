import type { LintResult } from '../analyzers/types.js';

export interface Reporter {
  report(result: LintResult): string;
}
