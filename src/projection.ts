import type {
  KiloConversation,
  KiloFolder,
  NormalizedWindowsDirectory,
  ProjectionOptions,
  RawKiloTimestamp,
  RawSessionMetadata,
} from './types.js';

const UNTITLED = 'Без названия';
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

interface CandidateConversation {
  session: RawSessionMetadata;
  directory: NormalizedWindowsDirectory;
  title: string;
  titleWasEmpty: boolean;
  updatedAt?: string;
}

interface FolderGroup {
  directory: NormalizedWindowsDirectory;
  conversations: KiloConversation[];
}

function decodeLocalFileUri(value: string): string | undefined {
  const match = /^file:(.*)$/i.exec(value);
  if (!match) {
    return undefined;
  }

  let pathPart = match[1];
  if (pathPart.startsWith('//')) {
    const authorityAndPath = pathPart.slice(2);
    const separatorIndex = authorityAndPath.search(/[\\/]/);
    const authority = separatorIndex === -1
      ? authorityAndPath
      : authorityAndPath.slice(0, separatorIndex);

    if (authority !== '' && authority.toLowerCase() !== 'localhost') {
      return undefined;
    }

    pathPart = separatorIndex === -1 ? '' : authorityAndPath.slice(separatorIndex);
  }

  if (pathPart.includes('?') || pathPart.includes('#')) {
    return undefined;
  }

  try {
    const decoded = decodeURIComponent(pathPart).replace(/\//g, '\\');
    return /^\\[A-Za-z]:\\/.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return undefined;
  }
}

function isValidWindowsSegment(segment: string): boolean {
  return segment.length > 0
    && ![...segment].some((character) => character.charCodeAt(0) <= 31)
    && !/[<>:"|?*]/.test(segment)
    && !/[. ]$/.test(segment)
    && !WINDOWS_RESERVED_NAME.test(segment);
}

/**
 * Converts an absolute drive path or local file URI to one Windows folder
 * identity. UNC, remote, workspace-file and malformed values are rejected.
 */
export function normalizeWindowsDirectory(
  value: string,
): NormalizedWindowsDirectory | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  let path = value;
  if (/^file:/i.test(path)) {
    const decoded = decodeLocalFileUri(path);
    if (decoded === undefined) {
      return undefined;
    }
    path = decoded;
  } else if (!/^[A-Za-z]:[\\/]/.test(path)) {
    return undefined;
  }

  path = path.replace(/\//g, '\\');
  if (!/^[A-Za-z]:\\/.test(path) || path.startsWith('\\\\')) {
    return undefined;
  }

  const drive = path[0].toUpperCase();
  const segments: string[] = [];
  for (const segment of path.slice(3).split('\\')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    if (!isValidWindowsSegment(segment)) {
      return undefined;
    }
    segments.push(segment);
  }

  const normalizedPath = segments.length === 0
    ? `${drive}:\\`
    : `${drive}:\\${segments.join('\\')}`;
  if (normalizedPath.toLowerCase().endsWith('.code-workspace')) {
    return undefined;
  }

  let encodedSegments: string[];
  try {
    encodedSegments = segments.map((segment) => encodeURIComponent(segment));
  } catch {
    return undefined;
  }

  return {
    path: normalizedPath,
    key: normalizedPath.toLowerCase(),
    uri: `file:///${drive}:/${encodedSegments.join('/')}`,
    name: segments.at(-1) ?? `${drive}:`,
  };
}

function normalizeTimestamp(value: RawKiloTimestamp | null): string | undefined {
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }

  const milliseconds = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return undefined;
  }

  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return undefined;
  }
}

function compareText(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareOptionalTimestampDescending(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left !== undefined && right !== undefined) {
    if (left > right) return -1;
    if (left < right) return 1;
    return 0;
  }
  if (left !== undefined) return -1;
  if (right !== undefined) return 1;
  return 0;
}

function compareConversations(left: KiloConversation, right: KiloConversation): number {
  return compareOptionalTimestampDescending(left.updatedAt, right.updatedAt)
    || compareText(left.title, right.title)
    || compareText(left.id, right.id);
}

function preferredDuplicate(
  left: CandidateConversation,
  right: CandidateConversation,
): CandidateConversation {
  const comparison = compareOptionalTimestampDescending(left.updatedAt, right.updatedAt)
    || compareText(left.title, right.title)
    || compareText(left.directory.path, right.directory.path);
  return comparison <= 0 ? left : right;
}

function toCandidate(session: RawSessionMetadata): CandidateConversation | undefined {
  if (
    session.parentId !== null
    || session.timeArchived !== null
    || typeof session.id !== 'string'
    || session.id.trim() === ''
    || typeof session.directory !== 'string'
    || (session.title !== null && typeof session.title !== 'string')
  ) {
    return undefined;
  }

  const directory = normalizeWindowsDirectory(session.directory);
  if (!directory) {
    return undefined;
  }

  const title = session.title;
  const titleWasEmpty = title === null || title.trim() === '';
  return {
    session,
    directory,
    title: titleWasEmpty ? UNTITLED : title,
    titleWasEmpty,
    updatedAt: normalizeTimestamp(session.timeUpdated),
  };
}

/** Builds the complete in-memory folder model from Kilo session metadata. */
export async function projectSessions(
  sessions: readonly RawSessionMetadata[],
  options: ProjectionOptions,
): Promise<KiloFolder[]> {
  const bySessionId = new Map<string, CandidateConversation>();
  const ambiguousSessionIds = new Set<string>();

  for (const session of sessions) {
    const candidate = toCandidate(session);
    if (!candidate || ambiguousSessionIds.has(candidate.session.id)) {
      continue;
    }

    const existing = bySessionId.get(candidate.session.id);
    if (!existing) {
      bySessionId.set(candidate.session.id, candidate);
    } else if (existing.directory.key !== candidate.directory.key) {
      bySessionId.delete(candidate.session.id);
      ambiguousSessionIds.add(candidate.session.id);
      options.onWarning?.(
        `Session "${candidate.session.id}" имеет конфликтующие directory; запись пропущена.`,
      );
    } else {
      bySessionId.set(
        candidate.session.id,
        preferredDuplicate(existing, candidate),
      );
    }
  }

  const groups = new Map<string, FolderGroup>();
  for (const candidate of bySessionId.values()) {
    if (candidate.titleWasEmpty) {
      options.onWarning?.(
        `Session "${candidate.session.id}" имеет пустой title; используется "${UNTITLED}".`,
      );
    }

    let group = groups.get(candidate.directory.key);
    if (!group) {
      group = { directory: candidate.directory, conversations: [] };
      groups.set(candidate.directory.key, group);
    }
    group.conversations.push({
      id: candidate.session.id,
      title: candidate.title,
      ...(candidate.updatedAt === undefined ? {} : { updatedAt: candidate.updatedAt }),
    });
  }

  const folders = await Promise.all([...groups.values()].map(async (group) => {
    group.conversations.sort(compareConversations);

    let available: boolean;
    try {
      available = await options.isDirectoryAvailable(group.directory.path);
    } catch {
      available = false;
    }

    const lastKiloActivityAt = group.conversations.find(
      (conversation) => conversation.updatedAt !== undefined,
    )?.updatedAt;

    return {
      id: group.directory.key,
      uri: group.directory.uri,
      name: group.directory.name,
      available,
      ...(lastKiloActivityAt === undefined ? {} : { lastKiloActivityAt }),
      conversations: group.conversations,
    } satisfies KiloFolder;
  }));

  folders.sort((left, right) => (
    compareOptionalTimestampDescending(left.lastKiloActivityAt, right.lastKiloActivityAt)
    || compareText(left.name, right.name)
    || compareText(left.id, right.id)
  ));
  return folders;
}
