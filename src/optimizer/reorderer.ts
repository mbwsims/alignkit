import type { Rule } from '../parsers/types.js';

/**
 * Reorder rules within each section by adherence (highest first).
 * Cross-section ordering is preserved.
 */
export function reorderRules(
  rules: Rule[],
  adherenceMap: Map<string, number>,
): Rule[] {
  // Group rules by section, preserving section order
  const sectionOrder: string[] = [];
  const sectionGroups = new Map<string, Rule[]>();

  for (const rule of rules) {
    const section = rule.source.section ?? '__no_section__';
    if (!sectionGroups.has(section)) {
      sectionOrder.push(section);
      sectionGroups.set(section, []);
    }
    sectionGroups.get(section)!.push(rule);
  }

  // Sort within each section by adherence descending
  const result: Rule[] = [];
  for (const section of sectionOrder) {
    const group = sectionGroups.get(section)!;
    const sorted = [...group].sort((a, b) => {
      const adhA = adherenceMap.get(a.id) ?? 0;
      const adhB = adherenceMap.get(b.id) ?? 0;
      return adhB - adhA;
    });
    result.push(...sorted);
  }

  return result;
}
