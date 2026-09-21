import { realpath, stat } from 'node:fs/promises';
import { win32 } from 'node:path';

const MAX_PENDING_LOCAL_PROBES = 16;
let activeLocalProbes = 0;
const probeWaiters: Array<() => void> = [];

async function acquireProbePermit(): Promise<() => void> {
  if (activeLocalProbes < MAX_PENDING_LOCAL_PROBES) {
    activeLocalProbes += 1;
  } else {
    await new Promise<void>((resolve) => probeWaiters.push(resolve));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = probeWaiters.shift();
    if (next === undefined) activeLocalProbes -= 1;
    else next();
  };
}

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
  const releasePermit = await acquireProbePermit();
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  const operation = realpath(path).then(async (resolved) => {
    const canonical = canonicalLocalWindowsPath(resolved);
    if (canonical === undefined) {
      return undefined;
    }
    const status = await stat(canonical);
    return status.isDirectory() ? canonical : undefined;
  }, () => undefined);
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (timedOut) {
      void operation.finally(releasePermit);
    } else {
      releasePermit();
    }
  }
}

export async function isAvailableLocalDirectory(
  path: string,
  timeoutMs = 500,
): Promise<boolean> {
  return await resolveAvailableLocalDirectory(path, timeoutMs) !== undefined;
}
