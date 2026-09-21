const WINDOWS_ABSOLUTE_PATH = /[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]*/gu;
const WINDOWS_UNC_PATH = /\\\\[^\\\s]+\\[^\r\n)\]}>'"]+/gu;
const FILE_URI = /file:\/\/\/[A-Za-z]:\/[^\s)\]}>'"]+/gu;

export function sanitizeDiagnostic(error: unknown): string {
  const raw = error instanceof Error
    ? error.stack ?? `${error.name}: ${error.message}`
    : String(error);
  const redacted = raw
    .replace(FILE_URI, '<local-path>')
    .replace(WINDOWS_UNC_PATH, '<local-path>')
    .replace(WINDOWS_ABSOLUTE_PATH, '<local-path>');
  return Array.from(redacted, (character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
      ? '?'
      : character;
  }).join('').slice(0, 4_000);
}

export function formatDiagnosticWarning(source: string, message: string): string {
  const safeSource = source.replace(/[^a-zA-Z0-9_-]/gu, '?').slice(0, 32);
  return `[${safeSource}] ${sanitizeDiagnostic(message)}`;
}
