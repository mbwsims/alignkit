import { createHash } from 'node:crypto';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function generateRuleId(text: string): string {
  const normalized = normalize(text);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function deduplicateSlugs(slugs: string[]): string[] {
  const counts = new Map<string, number>();
  return slugs.map((slug) => {
    const seen = counts.get(slug) ?? 0;
    counts.set(slug, seen + 1);
    return seen === 0 ? slug : `${slug}-${seen + 1}`;
  });
}
