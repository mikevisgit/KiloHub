import { AccordionController } from './accordion.js';
import type { AccordionItem } from './accordion.js';
import { TooltipController } from './tooltip.js';
import type { TooltipRegistration } from './tooltip.js';
import {
  PROTOCOL_VERSION,
  WEBVIEW_PROTOCOL_LIMITS,
  shouldApplyHostMessage,
} from '../webviewProtocol.js';
import type {
  BrowserToHostMessage,
  FolderAction,
  HostToBrowserMessage,
  HubFolderDto,
} from '../webviewProtocol.js';

interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): State;
  postMessage(message: BrowserToHostMessage): void;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

interface PersistedWebviewState {
  readonly version: typeof PROTOCOL_VERSION;
  readonly expandedFolderKey: number | null;
  readonly scrollTop: number;
}

export interface WebviewAppOptions {
  readonly document: Document;
  readonly environment: Window;
  readonly vscode: VsCodeApi<unknown>;
  readonly now?: () => Date;
}

export interface WebviewApp {
  dispose(): void;
}

interface ConversationView {
  readonly item: HTMLLIElement;
  readonly visibleTitle: HTMLSpanElement;
  readonly fullTitle: HTMLSpanElement;
  readonly tooltip: TooltipRegistration;
}

interface FolderView {
  readonly element: HTMLElement;
  readonly header: HTMLButtonElement;
  readonly monogram: HTMLSpanElement;
  readonly currentLabel: HTMLSpanElement;
  readonly name: HTMLSpanElement;
  readonly activity: HTMLSpanElement;
  readonly missingLabel: HTMLSpanElement;
  readonly details: HTMLDivElement;
  readonly detail: HTMLDivElement;
  readonly actions: HTMLDivElement;
  readonly actionButtons: Readonly<Record<FolderAction, HTMLButtonElement>>;
  readonly history: HTMLElement;
  readonly historyTitle: HTMLHeadingElement;
  readonly conversations: HTMLUListElement;
  readonly pathTooltip: TooltipRegistration;
  readonly actionTooltips: readonly TooltipRegistration[];
  readonly historyTooltip: TooltipRegistration;
  readonly conversationViews: Map<string, ConversationView>;
  dto: HubFolderDto;
}

interface FocusSnapshot {
  readonly key: string;
  readonly folderId: string | null;
  readonly folderIndex: number;
  readonly folderOrder: readonly string[];
}

type RgbColor = readonly [number, number, number];
type RgbaColor = readonly [number, number, number, number];

const INFO_TOOLTIP = 'Здесь собраны папки, в которых вы работали с Kilo. Чтобы вернуться к работе, выберите папку и откройте её.';
const REFRESH_TOOLTIP = 'Обновить список папок и диалогов из Kilo';
const HISTORY_TOOLTIP = 'До трёх последних диалогов. Открыть и продолжить их можно в Kilo Code';
const UNKNOWN_DATE = 'Дата неизвестна';
const DAY_MILLISECONDS = 86_400_000;
const RENDER_CHUNK_SIZE = 50;
const ACTIVITY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const COLOR_SLOT_ORDER = [1, 6, 12, 9, 15, 5, 2, 13, 8, 0, 10, 3, 14, 7, 11, 4] as const;
const COLOR_HUES = [0, 20, 38, 55, 76, 100, 130, 155, 175, 195, 215, 235, 255, 275, 300, 330] as const;
const LIGHT_FOLDER_FILLS = [
  '#efd9d9', '#f4deca', '#eee1ca', '#eee8ce',
  '#e5e9d1', '#dce8d0', '#d3e9d9', '#d1e9e1',
  '#d2e8e7', '#d5e7ed', '#d8e3f1', '#dde0f2',
  '#e5ddf5', '#eadcf0', '#eedbed', '#f0dbe4',
] as const;

const ACTION_COPY: Readonly<Record<FolderAction, {
  readonly label: string;
  readonly tooltip: string;
  readonly primary: boolean;
}>> = Object.freeze({
  openHere: {
    label: 'Открыть в этом окне',
    tooltip: 'Выбранная папка откроется вместо текущей в этом окне VS Code',
    primary: true,
  },
  openNewWindow: {
    label: 'Открыть в отдельном окне',
    tooltip: 'Текущая папка останется открытой',
    primary: false,
  },
  revealInExplorer: {
    label: 'Показать файлы папки',
    tooltip: 'Откроется Проводник Windows',
    primary: false,
  },
});

const FOLDER_ACTIONS = Object.freeze([
  'openHere',
  'openNewWindow',
  'revealInExplorer',
] as const satisfies readonly FolderAction[]);

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className !== undefined) {
    element.className = className;
  }
  return element;
}

function semanticKey(kind: string, ...parts: readonly string[]): string {
  return JSON.stringify([kind, ...parts]);
}

function exactDataObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
      return undefined;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return undefined;
      }
    }
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function restorePersistedState(value: unknown): PersistedWebviewState | undefined {
  const candidate = exactDataObject(value, [
    'version',
    'expandedFolderKey',
    'scrollTop',
  ]);
  if (candidate === undefined
    || candidate.version !== PROTOCOL_VERSION
    || !(candidate.expandedFolderKey === null
      || (typeof candidate.expandedFolderKey === 'number'
        && Number.isSafeInteger(candidate.expandedFolderKey)
        && candidate.expandedFolderKey >= 0
        && candidate.expandedFolderKey <= 0xffff_ffff))
    || typeof candidate.scrollTop !== 'number'
    || !Number.isFinite(candidate.scrollTop)
    || candidate.scrollTop < 0) {
    return undefined;
  }
  return candidate as unknown as PersistedWebviewState;
}

function persistedFolderKey(id: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function plural(value: number, one: string, few: string, many: string): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = value % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function calendarParts(value: Date, timeZone?: string): CalendarParts {
  if (timeZone === undefined) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(value);
  const numeric = (type: Intl.DateTimeFormatPartTypes): number => Number(
    parts.find((part) => part.type === type)?.value,
  );
  return {
    year: numeric('year'),
    month: numeric('month'),
    day: numeric('day'),
    hour: numeric('hour'),
    minute: numeric('minute'),
  };
}

/** Browser-only formatter kept independent from the host presentation import chain. */
export function formatBrowserRelativeActivity(
  value: string | undefined,
  now: Date,
  timeZone?: string,
): string {
  if (value === undefined || !ACTIVITY_PATTERN.test(value)) {
    return UNKNOWN_DATE;
  }
  const timestamp = Date.parse(value);
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(timestamp)
    || !Number.isFinite(nowTimestamp)
    || new Date(timestamp).toISOString() !== value
    || timestamp > nowTimestamp) {
    return UNKNOWN_DATE;
  }

  const activity = new Date(timestamp);
  const nowParts = calendarParts(now, timeZone);
  const activityParts = calendarParts(activity, timeZone);
  const nowDay = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) / DAY_MILLISECONDS;
  const activityDay = Date.UTC(
    activityParts.year,
    activityParts.month - 1,
    activityParts.day,
  ) / DAY_MILLISECONDS;
  const days = nowDay - activityDay;
  if (days < 0) return UNKNOWN_DATE;
  if (days === 0) {
    return `Сегодня, ${activityParts.hour.toString().padStart(2, '0')}:${activityParts.minute.toString().padStart(2, '0')}`;
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
  return years === 1 ? 'Год назад' : `${years} ${plural(years, 'год', 'года', 'лет')} назад`;
}

function hexToRgb(value: string): RgbColor {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as unknown as RgbColor;
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

function luminance(color: RgbColor): number {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: RgbColor, right: RgbColor): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

function readableMonochrome(background: RgbColor): RgbColor {
  const black = [0, 0, 0] as const;
  const white = [255, 255, 255] as const;
  return contrast(black, background) >= contrast(white, background) ? black : white;
}

function parseCssChannel(value: string): number | undefined {
  const channel = value.endsWith('%')
    ? Number.parseFloat(value) * 2.55
    : Number.parseFloat(value);
  return Number.isFinite(channel) ? Math.min(255, Math.max(0, channel)) : undefined;
}

function parseCssAlpha(value: string | undefined): number | undefined {
  if (value === undefined) return 1;
  const alpha = value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value);
  return Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : undefined;
}

function parseCssColor(value: string): RgbaColor | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'transparent') return [0, 0, 0, 0];
  if (normalized === 'black') return [0, 0, 0, 1];
  if (normalized === 'white') return [255, 255, 255, 1];
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/u.exec(normalized);
  if (hex !== null) {
    const rgb = hexToRgb(`#${hex[1]}`);
    return [rgb[0], rgb[1], rgb[2], hex[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255];
  }
  const functional = /^rgba?\((.+)\)$/u.exec(normalized);
  if (functional === null) return undefined;
  const [channelsText, slashAlpha] = functional[1].split('/').map((part) => part.trim());
  const commaParts = channelsText.split(',').map((part) => part.trim());
  const parts = commaParts.length >= 3 ? commaParts : channelsText.split(/\s+/u);
  const red = parseCssChannel(parts[0] ?? '');
  const green = parseCssChannel(parts[1] ?? '');
  const blue = parseCssChannel(parts[2] ?? '');
  const alpha = parseCssAlpha(slashAlpha ?? parts[3]);
  return red === undefined || green === undefined || blue === undefined || alpha === undefined
    ? undefined
    : [red, green, blue, alpha];
}

function composite(foreground: RgbaColor, background: RgbColor): RgbColor {
  return [0, 1, 2].map((index) => Math.round(
    foreground[index] * foreground[3] + background[index] * (1 - foreground[3]),
  )) as unknown as RgbColor;
}

function isHighContrast(document: Document): boolean {
  const bodyClasses = document.body.classList;
  const kind = document.documentElement.dataset.vscodeThemeKind ?? '';
  return bodyClasses.contains('vscode-high-contrast')
    || bodyClasses.contains('vscode-high-contrast-light')
    || kind.includes('high-contrast');
}

function fallbackSurface(document: Document): RgbColor {
  return document.body.classList.contains('vscode-light')
    || document.body.classList.contains('vscode-high-contrast-light')
    ? [255, 255, 255]
    : [0, 0, 0];
}

function themeSurface(document: Document, environment: Window, owner: HTMLElement): RgbColor {
  const fallback = fallbackSurface(document);
  const layers: RgbaColor[] = [];
  for (let current: HTMLElement | null = owner; current !== null; current = current.parentElement) {
    const color = parseCssColor(environment.getComputedStyle(current).backgroundColor);
    if (color !== undefined && color[3] > 0) layers.push(color);
  }
  const token = parseCssColor(
    environment.getComputedStyle(document.documentElement)
      .getPropertyValue('--vscode-sideBar-background'),
  );
  if (token !== undefined && token[3] > 0) layers.push(token);
  return layers.reverse().reduce((background, layer) => composite(layer, background), fallback);
}

function rgbCss(color: RgbColor): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function folderPalette(
  document: Document,
  environment: Window,
  surfaceOwner: HTMLElement,
  slot: number,
): { background: RgbColor; foreground: RgbColor; border: RgbColor | null } {
  const surface = themeSurface(document, environment, surfaceOwner);
  const paletteIndex = COLOR_SLOT_ORDER[slot];
  const hue = COLOR_HUES[paletteIndex];
  const light = luminance(surface) > 0.35;
  const background = light
    ? hexToRgb(LIGHT_FOLDER_FILLS[paletteIndex])
    : hslToRgb(hue, 24, 28);
  let foreground = hslToRgb(hue, 28, light ? 25 : 90);
  if (contrast(foreground, background) < 4.5) {
    foreground = readableMonochrome(background);
  }
  const border = isHighContrast(document) && contrast(background, surface) < 3
    ? readableMonochrome(surface)
    : null;
  return { background, foreground, border };
}

function applyFolderColorClass(view: FolderView): void {
  for (const className of Array.from(view.monogram.classList)) {
    if (className.startsWith('kilo-color-')) view.monogram.classList.remove(className);
  }
  if (view.dto.colorSlot !== null) {
    view.monogram.classList.add(`kilo-color-${view.dto.colorSlot}`);
  }
}

function actionAllowed(folder: HubFolderDto, action: FolderAction): boolean {
  return folder.available && (!folder.current || action === 'revealInExplorer');
}

function visibleActions(folder: HubFolderDto): readonly FolderAction[] {
  return FOLDER_ACTIONS.filter((action) => actionAllowed(folder, action));
}

/** Creates the browser surface. Tests inject the API; production acquires it once below. */
export function createWebviewApp(options: WebviewAppOptions): WebviewApp {
  const { document, environment, vscode } = options;
  const now = options.now ?? (() => new Date());
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('Kilo Hub Webview requires #app.');
  }
  const appRoot = root;
  appRoot.removeAttribute('aria-live');
  const existingThemeStyle = document.getElementById('kilo-hub-theme-style') as HTMLStyleElement | null;
  const themeStyle = existingThemeStyle ?? createElement(document, 'style');
  if (existingThemeStyle === null) {
    themeStyle.id = 'kilo-hub-theme-style';
    document.head.append(themeStyle);
  }

  const hub = createElement(document, 'section', 'hub');
  const intro = createElement(document, 'header', 'intro');
  const title = createElement(document, 'h1');
  title.textContent = 'Мои папки с Kilo';
  const info = createElement(document, 'button', 'icon-button info');
  info.type = 'button';
  info.textContent = 'ⓘ';
  info.setAttribute('aria-label', INFO_TOOLTIP);
  info.dataset.key = semanticKey('info');
  const refresh = createElement(document, 'button', 'icon-button refresh');
  refresh.type = 'button';
  refresh.textContent = '↻';
  refresh.setAttribute('aria-label', REFRESH_TOOLTIP);
  refresh.dataset.key = semanticKey('refresh');
  intro.append(title, info, refresh);

  const status = createElement(document, 'p', 'view-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const folders = createElement(document, 'div', 'folders');
  folders.setAttribute('role', 'list');
  hub.append(intro, status, folders);
  appRoot.replaceChildren(hub);

  const tooltipController = new TooltipController(hub, { environment });
  const staticTooltips = [
    tooltipController.register(info, INFO_TOOLTIP),
    tooltipController.register(refresh, REFRESH_TOOLTIP),
  ];
  const folderViews = new Map<string, FolderView>();
  let accordionController: AccordionController | null = null;
  let hostState: HostToBrowserMessage | null = null;
  let lastAppliedRevision: number | null = null;
  let expandedFolderId: string | null = null;
  let pendingExpandedFolderKey: number | null = null;
  let restoredScrollTop: number | undefined;
  let midnightTimer: number | null = null;
  let renderGeneration = 0;
  let pendingFocus: FocusSnapshot | null = null;
  let disposed = false;

  function persist(): void {
    if (disposed) return;
    vscode.setState({
      version: PROTOCOL_VERSION,
      expandedFolderKey: expandedFolderId === null ? null : persistedFolderKey(expandedFolderId),
      scrollTop: Math.max(0, folders.scrollTop),
    } satisfies PersistedWebviewState);
  }

  function postFolderAction(folderId: string, action: FolderAction): void {
    if (hostState === null) return;
    const folder = hostState.folders.find(({ id }) => id === folderId);
    if (folder === undefined || !actionAllowed(folder, action)) return;
    vscode.postMessage({
      type: 'folderAction',
      version: PROTOCOL_VERSION,
      revision: hostState.revision,
      folderId,
      action,
    });
  }

  function createActionButton(folderId: string, action: FolderAction): HTMLButtonElement {
    const copy = ACTION_COPY[action];
    const button = createElement(document, 'button', `action${copy.primary ? ' primary' : ''}`);
    button.type = 'button';
    const label = createElement(document, 'span', 'action-label');
    label.textContent = copy.label;
    button.append(label);
    button.setAttribute('aria-label', copy.label);
    button.dataset.action = action;
    button.dataset.key = semanticKey('folder-action', folderId, action);
    button.addEventListener('click', () => {
      postFolderAction(folderId, action);
    });
    return button;
  }

  function createFolderView(dto: HubFolderDto): FolderView {
    const element = createElement(document, 'article', 'folder');
    element.setAttribute('role', 'listitem');
    element.dataset.folderId = dto.id;
    const header = createElement(document, 'button', 'folder-head');
    header.type = 'button';
    header.dataset.key = semanticKey('folder-header', dto.id);
    const monogram = createElement(document, 'span', 'mono');
    monogram.setAttribute('aria-hidden', 'true');
    const identity = createElement(document, 'span', 'identity');
    const currentLabel = createElement(document, 'span', 'current-label');
    currentLabel.textContent = 'Вы сейчас здесь';
    const name = createElement(document, 'span', 'folder-name');
    const activity = createElement(document, 'span', 'activity');
    const missingLabel = createElement(document, 'span', 'missing-label');
    missingLabel.textContent = 'Папка не найдена';
    identity.append(currentLabel, name, activity, missingLabel);
    const chevron = createElement(document, 'span', 'chevron');
    chevron.textContent = '⌄';
    chevron.setAttribute('aria-hidden', 'true');
    header.append(monogram, identity, chevron);

    const details = createElement(document, 'div', 'detail-wrap');
    const detail = createElement(document, 'div', 'detail');
    const actions = createElement(document, 'div', 'actions');
    const actionButtons = Object.fromEntries(FOLDER_ACTIONS.map((action) => [
      action,
      createActionButton(dto.id, action),
    ])) as unknown as Record<FolderAction, HTMLButtonElement>;
    actions.append(...FOLDER_ACTIONS.map((action) => actionButtons[action]));
    const history = createElement(document, 'section', 'history');
    const historyTitle = createElement(document, 'h2', 'history-title');
    historyTitle.textContent = 'Последние диалоги';
    historyTitle.tabIndex = 0;
    historyTitle.dataset.key = semanticKey('folder-history', dto.id);
    const conversations = createElement(document, 'ul', 'conversation-list');
    history.append(historyTitle, conversations);
    detail.append(actions, history);
    details.append(detail);
    element.append(header, details);
    folders.append(element);

    const view: FolderView = {
      element,
      header,
      monogram,
      currentLabel,
      name,
      activity,
      missingLabel,
      details,
      detail,
      actions,
      actionButtons,
      history,
      historyTitle,
      conversations,
      pathTooltip: tooltipController.register(header, dto.path),
      actionTooltips: FOLDER_ACTIONS.map((action) => tooltipController.register(
        actionButtons[action],
        ACTION_COPY[action].tooltip,
      )),
      historyTooltip: tooltipController.register(historyTitle, HISTORY_TOOLTIP),
      conversationViews: new Map(),
      dto,
    };
    updateFolderView(view, dto);
    return view;
  }

  function updateConversationViews(view: FolderView, dto: HubFolderDto): void {
    const retained = new Set<string>();
    dto.conversations.slice(0, WEBVIEW_PROTOCOL_LIMITS.conversationsPerFolder)
      .forEach((conversation, index) => {
        const key = `${index}\u0000${conversation.id}`;
        retained.add(key);
        let conversationView = view.conversationViews.get(key);
        if (conversationView === undefined) {
          const item = createElement(document, 'li', 'conversation');
          const visibleTitle = createElement(document, 'span', 'conversation-visible');
          visibleTitle.setAttribute('aria-hidden', 'true');
          const fullTitle = createElement(document, 'span', 'sr-only');
          item.append(visibleTitle, fullTitle);
          view.conversations.append(item);
          conversationView = {
            item,
            visibleTitle,
            fullTitle,
            tooltip: tooltipController.register(visibleTitle, conversation.title, { focusable: false }),
          };
          view.conversationViews.set(key, conversationView);
        }
        conversationView.visibleTitle.textContent = conversation.title;
        conversationView.fullTitle.textContent = conversation.title;
        conversationView.tooltip.update(conversation.title);
        view.conversations.append(conversationView.item);
      });
    for (const [key, conversationView] of view.conversationViews) {
      if (retained.has(key)) continue;
      conversationView.tooltip.dispose();
      conversationView.item.remove();
      view.conversationViews.delete(key);
    }
  }

  function updateFolderAria(view: FolderView): void {
    const parts = [view.dto.name];
    if (view.dto.current && view.dto.available) parts.push('Вы сейчас здесь');
    if (!view.dto.available) parts.push('Папка не найдена');
    parts.push(view.activity.textContent ?? UNKNOWN_DATE);
    view.header.setAttribute('aria-label', parts.join('. '));
  }

  function updateFolderView(view: FolderView, dto: HubFolderDto): void {
    view.dto = dto;
    view.element.classList.toggle('current', dto.current && dto.available);
    view.element.classList.toggle('missing', !dto.available);
    view.monogram.textContent = dto.monogram;
    view.name.textContent = dto.name;
    view.currentLabel.hidden = !dto.current || !dto.available;
    view.missingLabel.hidden = dto.available;
    view.pathTooltip.update(dto.path);
    view.activity.textContent = formatBrowserRelativeActivity(dto.activity, now());
    updateFolderAria(view);
    updateConversationViews(view, dto);

    const actions = visibleActions(dto);
    const activeElement = document.activeElement;
    if (activeElement !== null && FOLDER_ACTIONS.some((action) => (
      !actions.includes(action) && view.actionButtons[action].contains(activeElement)
    ))) {
      view.header.focus({ preventScroll: true });
    }
    if (actions.length === 0) {
      view.actions.remove();
    } else {
      view.actions.replaceChildren(...actions.map((action) => view.actionButtons[action]));
      view.detail.insertBefore(view.actions, view.history);
    }
    applyFolderColorClass(view);
  }

  function disposeFolderView(view: FolderView): void {
    view.pathTooltip.dispose();
    view.historyTooltip.dispose();
    for (const registration of view.actionTooltips) registration.dispose();
    for (const conversation of view.conversationViews.values()) conversation.tooltip.dispose();
    view.element.remove();
  }

  function rebuildAccordion(): void {
    accordionController?.dispose();
    const items = (hostState?.folders ?? []).flatMap((folder): AccordionItem[] => {
      const view = folderViews.get(folder.id);
      return view === undefined ? [] : [{
        header: view.header,
        panel: view.details,
        expanded: folder.id === expandedFolderId,
      }];
    });
    accordionController = new AccordionController(folders, items, {
      environment,
      scrollContainer: folders,
      onExpandedChange: (item) => {
        expandedFolderId = item === null
          ? null
          : ([...folderViews.values()].find((view) => view.header === item.header)?.dto.id ?? null);
        persist();
      },
    });
  }

  function captureFocus(): FocusSnapshot | null {
    const active = document.activeElement;
    if (active === null || !('dataset' in active) || !appRoot.contains(active)) {
      return null;
    }
    const activeElement = active as HTMLElement;
    const key = activeElement.dataset.key;
    if (key === undefined) return null;
    const folderElement = activeElement.closest<HTMLElement>('.folder');
    const folderOrder = Array.from(folders.querySelectorAll<HTMLElement>('.folder'))
      .flatMap((element) => element.dataset.folderId === undefined ? [] : [element.dataset.folderId]);
    const folderId = folderElement?.dataset.folderId ?? null;
    return {
      key,
      folderId,
      folderIndex: folderId === null ? -1 : folderOrder.indexOf(folderId),
      folderOrder,
    };
  }

  function restoreFocus(snapshot: FocusSnapshot | null): void {
    if (snapshot === null) return;
    for (const element of Array.from(appRoot.querySelectorAll<HTMLElement>('[data-key]'))) {
      if (element.dataset.key === snapshot.key) {
        element.focus({ preventScroll: true });
        return;
      }
    }

    if (snapshot.folderId !== null) {
      const sameFolder = folderViews.get(snapshot.folderId);
      if (sameFolder !== undefined) {
        sameFolder.header.focus({ preventScroll: true });
        return;
      }
      for (let distance = 1; distance < snapshot.folderOrder.length; distance += 1) {
        const following = snapshot.folderOrder[snapshot.folderIndex + distance];
        const preceding = snapshot.folderOrder[snapshot.folderIndex - distance];
        const nearest = (following === undefined ? undefined : folderViews.get(following))
          ?? (preceding === undefined ? undefined : folderViews.get(preceding));
        if (nearest !== undefined) {
          nearest.header.focus({ preventScroll: true });
          return;
        }
      }
    }
    refresh.focus({ preventScroll: true });
  }

  function yieldRender(): Promise<void> {
    return new Promise((resolve) => environment.setTimeout(resolve, 0));
  }

  function renderIsCurrent(generation: number): boolean {
    return !disposed && generation === renderGeneration;
  }

  async function renderState(
    state: HostToBrowserMessage,
    generation: number,
    restoredScrollTop?: number,
  ): Promise<boolean> {
    const totalWork = folderViews.size + state.folders.length;
    const chunked = totalWork > RENDER_CHUNK_SIZE;
    if (chunked) {
      await yieldRender();
      if (!renderIsCurrent(generation)) return false;
    }
    pendingFocus = captureFocus() ?? pendingFocus;
    const focusSnapshot = pendingFocus;
    const previousScrollTop = restoredScrollTop ?? folders.scrollTop;
    if (pendingExpandedFolderKey !== null) {
      const matches = state.folders.filter(({ id }) => persistedFolderKey(id) === pendingExpandedFolderKey);
      expandedFolderId = matches.length === 1 ? matches[0].id : null;
      pendingExpandedFolderKey = null;
    }
    const nextIds = new Set(state.folders.map(({ id }) => id));
    const topologyChanged = folderViews.size !== nextIds.size
      || [...folderViews.keys()].some((id) => !nextIds.has(id));
    if (topologyChanged) accordionController?.dispose();

    let processed = 0;
    for (const [id, view] of folderViews) {
      if (nextIds.has(id)) continue;
      disposeFolderView(view);
      folderViews.delete(id);
      processed += 1;
      if (chunked && processed % RENDER_CHUNK_SIZE === 0 && processed < totalWork) {
        await yieldRender();
        if (!renderIsCurrent(generation)) return false;
      }
    }
    for (const dto of state.folders) {
      let view = folderViews.get(dto.id);
      if (view === undefined) {
        view = createFolderView(dto);
        folderViews.set(dto.id, view);
      } else {
        updateFolderView(view, dto);
      }
      folders.append(view.element);
      processed += 1;
      if (chunked && processed % RENDER_CHUNK_SIZE === 0 && processed < totalWork) {
        await yieldRender();
        if (!renderIsCurrent(generation)) return false;
      }
    }
    if (!renderIsCurrent(generation)) return false;
    if (expandedFolderId !== null && !nextIds.has(expandedFolderId)) {
      expandedFolderId = null;
    }
    if (topologyChanged || accordionController === null) rebuildAccordion();

    folders.scrollTop = previousScrollTop;
    restoreFocus(captureFocus() ?? focusSnapshot);
    pendingFocus = null;
    return true;
  }

  function applyState(value: unknown, restoredScrollTop?: number): boolean {
    if (!shouldApplyHostMessage(value, lastAppliedRevision)) return false;
    hostState = value;
    lastAppliedRevision = value.revision;
    const generation = ++renderGeneration;
    status.textContent = value.message ?? '';
    hub.setAttribute('aria-busy', String(value.busy));
    refresh.disabled = value.busy;
    void renderState(value, generation, restoredScrollTop).then((completed) => {
      if (completed && renderIsCurrent(generation)) persist();
    });
    return true;
  }

  function updateDates(): void {
    for (const view of folderViews.values()) {
      view.activity.textContent = formatBrowserRelativeActivity(view.dto.activity, now());
      updateFolderAria(view);
    }
  }

  function updateTheme(): void {
    themeStyle.textContent = COLOR_SLOT_ORDER.map((_, slot) => {
      const palette = folderPalette(document, environment, hub, slot);
      const border = palette.border === null ? 'transparent' : rgbCss(palette.border);
      return `.kilo-color-${slot}{--folder-bg:${rgbCss(palette.background)};--folder-fg:${rgbCss(palette.foreground)};--folder-border:${border}}`;
    }).join('\n');
    tooltipController.reposition();
  }

  function scheduleMidnight(): void {
    if (midnightTimer !== null) environment.clearTimeout(midnightTimer);
    const current = now();
    const next = new Date(current.getTime());
    next.setHours(24, 0, 0, 0);
    midnightTimer = environment.setTimeout(() => {
      midnightTimer = null;
      updateDates();
      scheduleMidnight();
    }, Math.max(1, next.getTime() - current.getTime()));
  }

  const onMessage = (event: MessageEvent<unknown>): void => {
    const applied = applyState(
      event.data,
      lastAppliedRevision === null ? restoredScrollTop : undefined,
    );
    if (applied) restoredScrollTop = undefined;
  };
  const onScroll = (): void => persist();
  const onRefresh = (): void => {
    if (hostState?.busy === true) return;
    vscode.postMessage({ type: 'refresh', version: PROTOCOL_VERSION });
  };
  const onFocus = (): void => {
    updateDates();
    updateTheme();
    scheduleMidnight();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') onFocus();
  };
  environment.addEventListener('message', onMessage as EventListener);
  environment.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  folders.addEventListener('scroll', onScroll);
  refresh.addEventListener('click', onRefresh);

  const MutationObserverConstructor = (environment as Window & typeof globalThis).MutationObserver;
  const themeObserver = new MutationObserverConstructor(updateTheme);
  const observedThemeAttributes = {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-vscode-theme-kind', 'data-vscode-theme-id'],
  };
  themeObserver.observe(document.documentElement, observedThemeAttributes);
  themeObserver.observe(document.body, observedThemeAttributes);
  const mediaQueries = ['(forced-colors: active)', '(prefers-color-scheme: dark)']
    .flatMap((query): MediaQueryList[] => typeof environment.matchMedia === 'function'
      ? [environment.matchMedia(query)]
      : []);
  for (const mediaQuery of mediaQueries) mediaQuery.addEventListener('change', updateTheme);

  const restored = restorePersistedState(vscode.getState());
  if (restored !== undefined) {
    pendingExpandedFolderKey = restored.expandedFolderKey;
    restoredScrollTop = restored.scrollTop;
  }
  updateTheme();
  scheduleMidnight();
  vscode.postMessage({ type: 'ready', version: PROTOCOL_VERSION });

  return {
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      renderGeneration += 1;
      if (midnightTimer !== null) environment.clearTimeout(midnightTimer);
      themeObserver.disconnect();
      for (const mediaQuery of mediaQueries) mediaQuery.removeEventListener('change', updateTheme);
      environment.removeEventListener('message', onMessage as EventListener);
      environment.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      folders.removeEventListener('scroll', onScroll);
      refresh.removeEventListener('click', onRefresh);
      accordionController?.dispose();
      for (const view of folderViews.values()) disposeFolderView(view);
      for (const registration of staticTooltips) registration.dispose();
      tooltipController.dispose();
    },
  };
}

if (typeof document !== 'undefined'
  && typeof window !== 'undefined'
  && typeof acquireVsCodeApi === 'function'
  && document.getElementById('app') !== null) {
  createWebviewApp({
    document,
    environment: window,
    vscode: acquireVsCodeApi<unknown>(),
  });
}
