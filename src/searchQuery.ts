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
  const tokens = [...new Set(normalized.split(/\s+/u))];
  if (tokens.some((token) => [...token].length < 3)) return { kind: 'invalid', reason: 'short-token' };
  return { kind: 'query', normalized: tokens.join(' '), tokens };
}
