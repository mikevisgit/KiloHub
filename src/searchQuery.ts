export function normalizeSearchText(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\u0451/g, '\u0435').normalize('NFC');
}

export type SearchQuery =
  | { kind: 'reset'; normalized: ''; tokens: readonly [] }
  | { kind: 'invalid'; reason: 'short-token' | 'too-long' }
  | { kind: 'query'; normalized: string; tokens: readonly string[] };

export function parseSearchQuery(raw: string): SearchQuery {
  if (raw.length > 4096) return { kind: 'invalid', reason: 'too-long' };
  const normalized = normalizeSearchText(raw).trim();
  if (!normalized) return { kind: 'reset', normalized: '', tokens: [] };
  const words = normalized.split(/\s+/u);
  const query = words.join(' ');
  if ([...query].length < 3) return { kind: 'invalid', reason: 'short-token' };
  // Preserve repeated words in the query so validation remains stable on the host and worker.
  return { kind: 'query', normalized: query, tokens: [...new Set(words)] };
}
