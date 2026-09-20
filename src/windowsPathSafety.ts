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

export async function isAvailableLocalDirectory(
  path: string,
  timeoutMs = 500,
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.all([stat(path), realpath(path)]).then(([status, resolved]) => (
        status.isDirectory() && isLocalResolvedWindowsPath(resolved)
      )),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
