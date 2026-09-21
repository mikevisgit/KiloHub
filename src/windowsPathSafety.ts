import { realpath, stat } from 'node:fs/promises';
import { win32 } from 'node:path';

export function isLocalResolvedWindowsPath(value: string): boolean {
  if (value.startsWith('\\\\?\\UNC\\')) {
    return false;
  }
  const isExtendedLocalPath = value.startsWith('\\\\?\\');
  if (!isExtendedLocalPath && value.startsWith('\\\\')) {
    return false;
  }
  const normalized = isExtendedLocalPath ? value.slice(4) : value;
  return /^[A-Za-z]:[\\/]/.test(normalized) && win32.isAbsolute(normalized);
}

function canonicalLocalWindowsPath(value: string): string | undefined {
  if (!isLocalResolvedWindowsPath(value)) {
    return undefined;
  }
  return win32.normalize(value.startsWith('\\\\?\\') ? value.slice(4) : value);
}

export async function resolveAvailableLocalDirectory(
  path: string,
  timeoutMs = 500,
): Promise<string | undefined> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      realpath(path).then(async (resolved) => {
        const canonical = canonicalLocalWindowsPath(resolved);
        if (canonical === undefined) {
          return undefined;
        }
        const status = await stat(canonical);
        return status.isDirectory() ? canonical : undefined;
      }),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function isAvailableLocalDirectory(
  path: string,
  timeoutMs = 500,
): Promise<boolean> {
  return await resolveAvailableLocalDirectory(path, timeoutMs) !== undefined;
}
