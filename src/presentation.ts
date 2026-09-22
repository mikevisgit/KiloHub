import { normalizeWindowsDirectory } from './projection.js';
import type { KiloConversation, KiloFolder, NormalizedWindowsDirectory } from './types.js';
import { normalizeSearchText } from './searchQuery.js';
import type { HubConversationDto, HubFolderDto } from './webviewProtocol.js';

const UNKNOWN_DATE = 'Дата неизвестна';
const UNTITLED = 'Без названия';
const DAY_MILLISECONDS = 86_400_000;
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const WORD_SEPARATOR = /[^\p{Letter}\p{Number}\p{Mark}]+/u;
const WORD_WITH_BASE = /[\p{Letter}\p{Number}]/u;

export const FOLDER_COLOR_SLOT_ORDER = Object.freeze([
  1, 6, 12, 9, 15, 5, 2, 13, 8, 0, 10, 3, 14, 7, 11, 4,
] as const);

export const FOLDER_COLOR_HUES = Object.freeze([
  0, 20, 38, 55, 76, 100, 130, 155, 175, 195, 215, 235, 255, 275, 300, 330,
] as const);

const LIGHT_FOLDER_FILLS = Object.freeze([
  '#efd9d9', '#f4deca', '#eee1ca', '#eee8ce',
  '#e5e9d1', '#dce8d0', '#d3e9d9', '#d1e9e1',
  '#d2e8e7', '#d5e7ed', '#d8e3f1', '#dde0f2',
  '#e5ddf5', '#eadcf0', '#eedbed', '#f0dbe4',
] as const);

export type RgbColor = readonly [number, number, number];

export interface RelativeActivityOptions {
  readonly now: Date | number;
  readonly timeZone: string;
}

export interface PresentationOptions {
  readonly currentFolderId: string | null;
  readonly now: Date | number;
  readonly temporaryCurrent?: NormalizedWindowsDirectory | null;
  readonly matches?: readonly { folderId: string; rank: 0 | 1 | 2 }[];
  readonly tokens?: readonly string[];
}

export interface AdaptivePaletteOptions {
  readonly highContrast?: boolean;
  readonly edge?: RgbColor;
}

export interface AdaptiveFolderPalette {
  readonly background: RgbColor;
  readonly foreground: RgbColor;
  readonly border: RgbColor | null;
}

interface ReliableConversation {
  readonly conversation: KiloConversation;
  readonly timestamp?: number;
}

function timestampFromNow(value: Date | number): number {
  const timestamp = typeof value === 'number' ? value : value.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError('now must be a valid finite timestamp');
  }
  return timestamp;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Accepts only explicit-zone, calendar-valid ISO timestamps at or before now. */
export function reliableIsoTimestamp(
  value: unknown,
  now: Date | number,
): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = ISO_TIMESTAMP.exec(value);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
  ) {
    return undefined;
  }

  const zone = match[8];
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= timestampFromNow(now)
    ? timestamp
    : undefined;
}

function zonedParts(timestamp: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
  };
}

function calendarDay(parts: ReturnType<typeof zonedParts>): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MILLISECONDS;
}

function plural(number: number, one: string, few: string, many: string): string {
  const lastTwo = number % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = number % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Formats activity by local calendar days without treating DST days as 24 hours. */
export function formatRelativeActivity(
  value: unknown,
  options: RelativeActivityOptions,
): string {
  const now = timestampFromNow(options.now);
  const timestamp = reliableIsoTimestamp(value, now);
  if (timestamp === undefined) {
    return UNKNOWN_DATE;
  }

  const nowParts = zonedParts(now, options.timeZone);
  const activityParts = zonedParts(timestamp, options.timeZone);
  const days = calendarDay(nowParts) - calendarDay(activityParts);
  if (days < 0) return UNKNOWN_DATE;
  if (days === 0) {
    const hour = activityParts.hour.toString().padStart(2, '0');
    const minute = activityParts.minute.toString().padStart(2, '0');
    return `Сегодня, ${hour}:${minute}`;
  }
  if (days === 1) return 'Вчера';
  if (days <= 6) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  if (days <= 13) return 'Неделю назад';
  if (days <= 20) return '2 недели назад';
  if (days <= 29) return '3 недели назад';
  if (days <= 59) return 'Месяц назад';
  if (days <= 364) {
    const months = Math.floor(days / 30);
    return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;
  }

  const years = Math.floor(days / 365);
  return years === 1
    ? 'Год назад'
    : `${years} ${plural(years, 'год', 'года', 'лет')} назад`;
}

function fallbackGraphemes(value: string): string[] {
  const result: string[] = [];
  for (const codePoint of value) {
    const previous = result.at(-1);
    if (previous !== undefined && (
      /\p{Mark}/u.test(codePoint)
      || codePoint === '\u200d'
      || /[\ufe00-\ufe0f]/u.test(codePoint)
      || /[\u{1f3fb}-\u{1f3ff}]/u.test(codePoint)
      || previous.endsWith('\u200d')
    )) {
      result[result.length - 1] += codePoint;
    } else {
      result.push(codePoint);
    }
  }
  return result;
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter !== 'function') {
    return fallbackGraphemes(value);
  }
  const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
  return [...segmenter.segment(value)].map(({ segment }) => segment);
}

function initialsFrom(value: string): string {
  const words = value
    .normalize('NFC')
    .trim()
    .split(WORD_SEPARATOR)
    .filter((word) => WORD_WITH_BASE.test(word));
  if (words.length === 0) return '';

  const selected = words.length === 1
    ? graphemes(words[0]).slice(0, 2)
    : [graphemes(words[0])[0], graphemes(words.at(-1) ?? '')[0]];
  return graphemes(selected.filter((value) => value !== undefined).join('').toLocaleUpperCase('ru-RU'))
    .slice(0, 2)
    .join('');
}

/** Creates one or two NFC Unicode graphemes, falling back to the safe path basename. */
export function createFolderMonogram(name: string, path: string): string {
  const fromName = initialsFrom(name);
  if (fromName !== '') return fromName;

  const basename = normalizeWindowsDirectory(path)?.name ?? '';
  return initialsFrom(basename) || '?';
}

/** Uses the Step 1 local-drive path boundary and returns its case-insensitive color key. */
export function normalizeFolderColorPath(path: unknown): string | null {
  if (typeof path !== 'string' || !/^[A-Za-z]:[\\/]/.test(path)) {
    return null;
  }
  return normalizeWindowsDirectory(path)?.key ?? null;
}

/** FNV-1a over JavaScript UTF-16 code units. */
export function fnv1aUtf16(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash;
}

export function folderColorSlot(path: unknown): number | null {
  const key = normalizeFolderColorPath(path);
  return key === null ? null : fnv1aUtf16(key) % 16;
}

function luminance(color: RgbColor): number {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function colorContrast(left: RgbColor, right: RgbColor): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

function hslToRgb(hue: number, saturationPercent: number, lightnessPercent: number): RgbColor {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map((offset) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  }) as unknown as RgbColor;
}

function hexToRgb(hex: string): RgbColor {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as unknown as RgbColor;
}

function readableMonochrome(background: RgbColor): RgbColor {
  const black = [0, 0, 0] as const;
  const white = [255, 255, 255] as const;
  return colorContrast(black, background) >= colorContrast(white, background) ? black : white;
}

function assertRgb(color: RgbColor): void {
  if (color.length !== 3 || color.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    throw new RangeError('RGB channels must be finite values from 0 through 255');
  }
}

/** Computes the adaptive badge colors for a raw FNV slot. */
export function createAdaptiveFolderPalette(
  slot: number,
  surface: RgbColor,
  options: AdaptivePaletteOptions = {},
): AdaptiveFolderPalette {
  if (!Number.isInteger(slot) || slot < 0 || slot >= FOLDER_COLOR_SLOT_ORDER.length) {
    throw new RangeError('slot must be an integer from 0 through 15');
  }
  assertRgb(surface);
  const edge = options.edge ?? surface;
  assertRgb(edge);

  const paletteIndex = FOLDER_COLOR_SLOT_ORDER[slot];
  const hue = FOLDER_COLOR_HUES[paletteIndex];
  const light = luminance(surface) > 0.35;
  const background = light
    ? hexToRgb(LIGHT_FOLDER_FILLS[paletteIndex])
    : hslToRgb(hue, 24, 28);
  let foreground = hslToRgb(hue, 28, light ? 25 : 90);
  if (colorContrast(foreground, background) < 4.5) {
    foreground = readableMonochrome(background);
  }
  const border = options.highContrast === true && colorContrast(background, edge) < 3
    ? readableMonochrome(edge)
    : null;
  return { background, foreground, border };
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

function compareReliableConversations(left: ReliableConversation, right: ReliableConversation): number {
  if (left.timestamp !== undefined && right.timestamp !== undefined) {
    if (left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
  } else if (left.timestamp !== undefined) {
    return -1;
  } else if (right.timestamp !== undefined) {
    return 1;
  }
  return compareText(left.conversation.title, right.conversation.title)
    || compareText(left.conversation.id, right.conversation.id);
}

function displayConversations(
  conversations: readonly KiloConversation[],
  now: number,
): { activity?: string; conversations: HubConversationDto[]; activityTimestamp?: number } {
  const reliable = conversations.map((conversation): ReliableConversation => ({
    conversation,
    timestamp: reliableIsoTimestamp(conversation.updatedAt, now),
  }));
  reliable.sort(compareReliableConversations);
  const activityTimestamp = reliable.find(({ timestamp }) => timestamp !== undefined)?.timestamp;
  return {
    ...(activityTimestamp === undefined
      ? {}
      : { activity: new Date(activityTimestamp).toISOString(), activityTimestamp }),
    conversations: reliable.slice(0, 3).map(({ conversation }) => ({
      id: conversation.id,
      title: conversation.title.trim() === '' ? UNTITLED : conversation.title,
    })),
  };
}

/** Builds deterministic browser DTOs without mutating the domain snapshot. */
export function presentFolders(
  folders: readonly KiloFolder[],
  options: PresentationOptions,
): HubFolderDto[] {
  const now = timestampFromNow(options.now);
  const presented = folders.map((folder) => {
    const display = displayConversations(folder.conversations, now);
    return {
      dto: {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        available: folder.available,
        current: folder.id === options.currentFolderId,
        ...(display.activity === undefined ? {} : { activity: display.activity }),
        monogram: createFolderMonogram(folder.name, folder.path),
        colorSlot: folderColorSlot(folder.path),
        conversations: display.conversations,
      } satisfies HubFolderDto,
      activityTimestamp: display.activityTimestamp,
      pathKey: normalizeFolderColorPath(folder.path) ?? folder.id,
    };
  });

  presented.sort((left, right) => {
    if (left.dto.current !== right.dto.current) return left.dto.current ? -1 : 1;
    if (left.activityTimestamp !== undefined && right.activityTimestamp !== undefined) {
      if (left.activityTimestamp !== right.activityTimestamp) {
        return right.activityTimestamp - left.activityTimestamp;
      }
    } else if (left.activityTimestamp !== undefined) {
      return -1;
    } else if (right.activityTimestamp !== undefined) {
      return 1;
    }
    return compareText(left.dto.name, right.dto.name)
      || compareText(left.pathKey, right.pathKey)
      || compareText(left.dto.id, right.dto.id);
  });
  const ranks = options.matches === undefined ? null : new Map(options.matches.map(({ folderId, rank }) => [folderId, rank]));
  const result: HubFolderDto[] = presented.map(({ dto }) => dto)
    .filter(({ id }) => ranks === null || ranks.has(id));
  if (ranks !== null) result.sort((left, right) => Number(right.current) - Number(left.current)
    || (ranks.get(left.id) ?? 0) - (ranks.get(right.id) ?? 0));
  const temporary = options.temporaryCurrent;
  if (temporary && !folders.some(({ id }) => id === temporary.key)
    && (options.tokens ?? []).every((token) => normalizeSearchText(temporary.name).includes(token))) {
    result.unshift({ id: temporary.key, name: temporary.name, path: temporary.path,
      current: true, available: true, temporary: true, conversations: [],
      monogram: createFolderMonogram(temporary.name, temporary.path), colorSlot: folderColorSlot(temporary.path) });
  }
  return result;
}
