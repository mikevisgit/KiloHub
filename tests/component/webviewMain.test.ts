import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Window as HappyWindow } from 'happy-dom' with { 'resolution-mode': 'import' };

import {
  createWebviewApp,
  formatBrowserRelativeActivity,
} from '../../src/webview/main.js';
import type { WebviewApp } from '../../src/webview/main.js';
import {
  PROTOCOL_VERSION,
  WEBVIEW_STATE_MESSAGES,
} from '../../src/webviewProtocol.js';
import type {
  BrowserToHostMessage,
  HostToBrowserMessage,
  HubFolderDto,
} from '../../src/webviewProtocol.js';

class FakeVsCodeApi {
  public readonly messages: BrowserToHostMessage[] = [];
  public state: unknown;

  public constructor(state?: unknown) {
    this.state = state;
  }

  public getState(): unknown {
    return this.state;
  }

  public setState(state: unknown): unknown {
    this.state = state;
    return state;
  }

  public postMessage(message: BrowserToHostMessage): void {
    this.messages.push(message);
  }
}

interface Harness {
  readonly window: HappyWindow;
  readonly api: FakeVsCodeApi;
  readonly app: WebviewApp;
  readonly document: Document;
  send(message: unknown): void;
  dispose(): void;
}

function folder(overrides: Partial<HubFolderDto> = {}): HubFolderDto {
  return {
    id: 'c:\\work\\alpha',
    name: 'Alpha',
    path: 'C:\\Work\\Alpha',
    available: true,
    current: false,
    activity: '2026-09-20T10:20:30.000Z',
    monogram: 'AL',
    colorSlot: 0,
    conversations: [{ id: 'session-1', title: 'Первый диалог' }],
    ...overrides,
  };
}

function ready(revision: number, folders: readonly HubFolderDto[]): HostToBrowserMessage {
  return {
    version: PROTOCOL_VERSION,
    revision,
    kind: 'ready',
    folders,
    message: folders.length === 0 ? WEBVIEW_STATE_MESSAGES.empty : null,
    busy: false,
  };
}

async function setup(options: {
  readonly restored?: unknown;
  readonly now?: () => Date;
  readonly beforeStart?: (window: HappyWindow) => void;
} = {}): Promise<Harness> {
  const { Window: HappyWindowConstructor } = await import('happy-dom');
  const window = new HappyWindowConstructor({ url: 'https://webview.test/' });
  const document = window.document as unknown as Document;
  const root = document.createElement('main');
  root.id = 'app';
  root.setAttribute('aria-live', 'polite');
  document.body.append(root);
  options.beforeStart?.(window);
  const api = new FakeVsCodeApi(options.restored);
  const app = createWebviewApp({
    document,
    environment: window as unknown as Window,
    vscode: api,
    now: options.now,
  });
  return {
    window,
    api,
    app,
    document,
    send: (message: unknown): void => {
      window.dispatchEvent(new window.MessageEvent('message', { data: message }));
    },
    dispose: (): void => {
      app.dispose();
      void window.close();
    },
  };
}

function folderElement(document: Document, id: string): HTMLElement {
  const match = Array.from(document.querySelectorAll<HTMLElement>('.folder'))
    .find((element) => element.dataset.folderId === id);
  assert.ok(match, `folder ${id} must exist`);
  return match;
}

function buttonActions(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll<HTMLButtonElement>('.action'))
    .map((button) => button.dataset.action ?? '');
}

function waitFor(window: HappyWindow, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      attempts += 1;
      if (attempts >= 100) {
        reject(new Error('Timed out waiting for browser render.'));
        return;
      }
      window.setTimeout(check, 0);
    };
    check();
  });
}

void test('persists only opaque UI state and restores it after the host republishes data', async () => {
  const first = await setup({
    beforeStart: (window) => window.document.body.classList.add('vscode-reduce-motion'),
  });
  let restored: unknown;
  try {
    first.send(ready(7, [folder()]));
    (first.document.querySelector('.folder-head') as HTMLButtonElement).click();
    await Promise.resolve();
    const scroller = first.document.querySelector('.folders') as HTMLElement;
    scroller.scrollTop = 37;
    scroller.dispatchEvent(new first.window.Event('scroll') as unknown as Event);
    restored = first.api.state;
    const serialized = JSON.stringify(restored);
    assert.doesNotMatch(serialized, /Alpha|C:\\Work|session-1|Первый диалог|hostState/u);
    assert.deepEqual(Object.keys(restored as object).sort(), ['expandedFolderKey', 'scrollTop', 'version']);
  } finally {
    first.dispose();
  }

  const second = await setup({ restored });
  try {
    assert.equal(second.document.querySelector('h1')?.textContent, 'Мои папки с Kilo');
    assert.equal(second.document.querySelectorAll('h1').length, 1);
    assert.equal(second.document.getElementById('app')?.hasAttribute('aria-live'), false);
    assert.equal(second.document.querySelectorAll('[aria-live]').length, 1);
    assert.equal(second.document.querySelector('[aria-live]')?.classList.contains('view-status'), true);
    const info = second.document.querySelector<HTMLButtonElement>('.info');
    assert.equal(info?.textContent, 'ⓘ');
    assert.equal(
      info?.getAttribute('aria-label'),
      'Здесь собраны папки, в которых вы работали с Kilo. Чтобы вернуться к работе, выберите папку и откройте её.',
    );
    assert.equal(second.document.body.textContent?.includes('Kilo Folders'), false);
    assert.equal(second.document.querySelectorAll('.folder').length, 0);
    assert.deepEqual(second.api.messages, [{ type: 'ready', version: PROTOCOL_VERSION }]);
    second.send(ready(7, [folder()]));
    assert.equal(second.document.querySelector('.folder-head')?.getAttribute('aria-expanded'), 'true');
    assert.equal((second.document.querySelector('.folders') as HTMLElement).scrollTop, 37);
  } finally {
    second.dispose();
  }
});

void test('ignores hostile, malformed, duplicate and stale host messages', async () => {
  let getterCalls = 0;
  const hostileState = Object.defineProperty({}, 'hostState', {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });
  const harness = await setup({ restored: hostileState });
  try {
    assert.equal(getterCalls, 0);
    harness.send({ ...ready(1, [folder()]), extra: '<script>bad()</script>' });
    assert.equal(harness.document.querySelectorAll('.folder').length, 0);
    harness.send(ready(2, [folder()]));
    assert.equal(harness.document.querySelectorAll('.folder').length, 1);
    const original = harness.document.querySelector('.folder');
    harness.send(ready(2, [folder({ name: 'Duplicate' })]));
    harness.send(ready(1, [folder({ name: 'Stale' })]));
    assert.equal(harness.document.querySelector('.folder'), original);
    assert.equal(harness.document.querySelector('.folder-name')?.textContent, 'Alpha');
  } finally {
    harness.dispose();
  }
});

void test('reuses keyed folders and retains expansion, focus and scroll on state updates', async () => {
  const first = folder({ id: 'first', name: 'First', path: 'C:\\First' });
  const second = folder({ id: 'second', name: 'Second', path: 'C:\\Second' });
  const harness = await setup();
  try {
    harness.send(ready(1, [first, second]));
    const firstElement = folderElement(harness.document, 'first');
    const firstHeader = firstElement.querySelector<HTMLButtonElement>('.folder-head');
    assert.ok(firstHeader);
    const pathTooltipId = firstHeader.getAttribute('aria-describedby');
    assert.ok(pathTooltipId);
    const pathTooltip = harness.document.getElementById(pathTooltipId);
    assert.ok(pathTooltip);
    firstHeader.click();
    firstHeader.focus();
    const scroller = harness.document.querySelector<HTMLElement>('.folders');
    assert.ok(scroller);
    scroller.scrollTop = 29;
    scroller.dispatchEvent(new harness.window.Event('scroll') as unknown as Event);

    harness.send({
      version: PROTOCOL_VERSION,
      revision: 2,
      kind: 'refreshing',
      folders: [second, { ...first, name: 'First renamed', path: 'C:\\First renamed' }],
      message: WEBVIEW_STATE_MESSAGES.refreshing,
      busy: true,
    });
    assert.equal(folderElement(harness.document, 'first'), firstElement);
    assert.equal(firstElement.querySelector('.folder-head'), firstHeader);
    assert.equal(firstHeader.getAttribute('aria-describedby'), pathTooltipId);
    assert.equal(harness.document.getElementById(pathTooltipId), pathTooltip);
    assert.equal(pathTooltip.textContent, 'C:\\First renamed');
    assert.equal(firstHeader.getAttribute('aria-expanded'), 'true');
    assert.equal(harness.document.activeElement, firstHeader);
    assert.equal(scroller.scrollTop, 29);
    assert.equal(firstElement.querySelector('.folder-name')?.textContent, 'First renamed');
  } finally {
    harness.dispose();
  }
});

void test('renders the exact current/missing action matrix and posts current revision', async () => {
  const normal = folder({ id: 'normal', path: 'C:\\Normal' });
  const current = folder({ id: 'current', path: 'C:\\Current', current: true });
  const missing = folder({ id: 'missing', path: 'C:\\Missing', available: false });
  const missingCurrent = folder({
    id: 'missing-current',
    path: 'C:\\MissingCurrent',
    available: false,
    current: true,
  });
  const harness = await setup();
  try {
    harness.send(ready(11, [current, normal, missing, missingCurrent]));
    assert.deepEqual(buttonActions(folderElement(harness.document, 'normal')), [
      'openHere', 'openNewWindow', 'revealInExplorer',
    ]);
    assert.equal(harness.document.querySelector('.action-icon'), null);
    assert.equal(
      folderElement(harness.document, 'normal').querySelector('[data-action="openHere"]')?.textContent,
      'Открыть в этом окне',
    );
    assert.deepEqual(buttonActions(folderElement(harness.document, 'current')), ['revealInExplorer']);
    for (const id of ['missing', 'missing-current']) {
      const element = folderElement(harness.document, id);
      assert.equal(element.querySelector('.actions'), null);
      assert.equal(buttonActions(element).length, 0);
      assert.equal(element.querySelector('.detail')?.firstElementChild?.className, 'history');
    }

    const normalOpen = folderElement(harness.document, 'normal')
      .querySelector<HTMLButtonElement>('[data-action="openHere"]');
    const currentReveal = folderElement(harness.document, 'current')
      .querySelector<HTMLButtonElement>('[data-action="revealInExplorer"]');
    assert.ok(normalOpen);
    assert.ok(currentReveal);
    normalOpen.click();
    currentReveal.click();
    assert.deepEqual(harness.api.messages.slice(1), [
      {
        type: 'folderAction',
        version: PROTOCOL_VERSION,
        revision: 11,
        folderId: 'normal',
        action: 'openHere',
      },
      {
        type: 'folderAction',
        version: PROTOCOL_VERSION,
        revision: 11,
        folderId: 'current',
        action: 'revealInExplorer',
      },
    ]);
  } finally {
    harness.dispose();
  }
});

void test('shows every load state and disables refresh while busy', async () => {
  const harness = await setup();
  try {
    const refresh = harness.document.querySelector<HTMLButtonElement>('.refresh');
    const status = harness.document.querySelector<HTMLElement>('.view-status');
    assert.ok(refresh);
    assert.ok(status);
    harness.send({
      version: PROTOCOL_VERSION,
      revision: 1,
      kind: 'loading',
      folders: [],
      message: WEBVIEW_STATE_MESSAGES.loading,
      busy: true,
    });
    assert.equal(status.textContent, WEBVIEW_STATE_MESSAGES.loading);
    assert.equal(refresh.disabled, true);
    refresh.click();
    assert.equal(harness.api.messages.length, 1);

    harness.send(ready(2, []));
    assert.equal(status.textContent, WEBVIEW_STATE_MESSAGES.empty);
    assert.equal(refresh.disabled, false);
    refresh.click();
    assert.deepEqual(harness.api.messages.at(-1), { type: 'refresh', version: PROTOCOL_VERSION });

    harness.send({
      version: PROTOCOL_VERSION,
      revision: 3,
      kind: 'initialError',
      folders: [],
      message: WEBVIEW_STATE_MESSAGES.initialError,
      busy: false,
    });
    assert.equal(status.textContent, WEBVIEW_STATE_MESSAGES.initialError);
    harness.send({
      version: PROTOCOL_VERSION,
      revision: 4,
      kind: 'refreshError',
      folders: [folder()],
      message: WEBVIEW_STATE_MESSAGES.refreshError,
      busy: false,
    });
    assert.equal(status.textContent, WEBVIEW_STATE_MESSAGES.refreshError);
    assert.equal(harness.document.querySelectorAll('.folder').length, 1);
  } finally {
    harness.dispose();
  }
});

void test('uses text-only DOM and exposes full passive conversation text once to screen readers', async () => {
  const hostileName = '<img src=x onerror=alert(1)>';
  const hostilePath = 'C:\\<script>bad()</script>';
  const hostileTitle = '<script>conversation()</script>';
  const harness = await setup({ now: () => new Date('2026-09-20T12:00:00.000Z') });
  try {
    harness.send(ready(1, [folder({
      name: hostileName,
      path: hostilePath,
      current: true,
      available: false,
      conversations: [{ id: 'hostile', title: hostileTitle }],
    })]));
    const element = harness.document.querySelector<HTMLElement>('.folder');
    assert.ok(element);
    assert.equal(element.querySelector('img, script'), null);
    assert.equal(element.querySelector('.folder-name')?.textContent, hostileName);
    assert.equal(element.querySelector('.mono')?.getAttribute('aria-hidden'), 'true');
    const headerLabel = element.querySelector('.folder-head')?.getAttribute('aria-label') ?? '';
    assert.doesNotMatch(headerLabel, /Путь:/u);
    assert.doesNotMatch(headerLabel, /C:\\<script>bad\(\)<\/script>/u);
    assert.doesNotMatch(headerLabel, /Вы сейчас здесь/u);
    assert.match(headerLabel, /Папка не найдена/u);
    assert.match(headerLabel, /Сегодня/u);
    const descriptionId = element.querySelector('.folder-head')?.getAttribute('aria-describedby');
    assert.ok(descriptionId);
    assert.equal(harness.document.getElementById(descriptionId)?.textContent, hostilePath);
    assert.equal(element.classList.contains('current'), false);
    assert.equal(element.querySelector<HTMLElement>('.current-label')?.hidden, true);

    const conversation = element.querySelector<HTMLElement>('.conversation');
    assert.ok(conversation);
    assert.equal(conversation.hasAttribute('tabindex'), false);
    assert.equal(conversation.getAttribute('role'), null);
    assert.equal(conversation.querySelector('[aria-hidden="true"]')?.textContent, hostileTitle);
    assert.equal(conversation.querySelector('.sr-only')?.textContent, hostileTitle);
    assert.equal(element.querySelectorAll('.conversation .sr-only').length, 1);
    assert.equal(element.querySelector('.history-title')?.tagName, 'H2');
  } finally {
    harness.dispose();
  }
});

void test('refreshes reliable local relative dates on focus without a host message', async () => {
  let clock = new Date(2026, 8, 20, 12, 0, 0, 0);
  const activity = new Date(2026, 8, 20, 10, 5, 0, 0).toISOString();
  const harness = await setup({ now: () => new Date(clock.getTime()) });
  try {
    harness.send(ready(1, [folder({ activity })]));
    assert.equal(harness.document.querySelector('.activity')?.textContent, 'Сегодня, 10:05');
    const messageCount = harness.api.messages.length;
    clock = new Date(2026, 8, 21, 0, 1, 0, 0);
    harness.window.dispatchEvent(new harness.window.Event('focus'));
    assert.equal(harness.document.querySelector('.activity')?.textContent, 'Вчера');
    assert.equal(harness.api.messages.length, messageCount);
    assert.equal(
      formatBrowserRelativeActivity(new Date(clock.getTime() + 1).toISOString(), clock),
      'Дата неизвестна',
    );
    assert.equal(formatBrowserRelativeActivity('invalid', clock), 'Дата неизвестна');
  } finally {
    harness.dispose();
  }
});

void test('browser date labels cover canonical boundaries, plural forms, leap day and DST', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, 'Сегодня, 12:00'],
    [1, 'Вчера'],
    [2, '2 дня назад'],
    [6, '6 дней назад'],
    [7, 'Неделю назад'],
    [13, 'Неделю назад'],
    [14, '2 недели назад'],
    [20, '2 недели назад'],
    [21, '3 недели назад'],
    [29, '3 недели назад'],
    [30, 'Месяц назад'],
    [59, 'Месяц назад'],
    [60, '2 месяца назад'],
    [330, '11 месяцев назад'],
    [364, '12 месяцев назад'],
    [365, 'Год назад'],
    [730, '2 года назад'],
    [1_825, '5 лет назад'],
  ];
  for (const [days, expected] of cases) {
    assert.equal(
      formatBrowserRelativeActivity(
        new Date(now.getTime() - days * 86_400_000).toISOString(),
        now,
        'UTC',
      ),
      expected,
      `${days} calendar days`,
    );
  }
  assert.equal(
    formatBrowserRelativeActivity(
      '2024-03-10T06:30:00.000Z',
      new Date('2024-03-11T04:30:00.000Z'),
      'America/New_York',
    ),
    'Вчера',
  );
  assert.equal(
    formatBrowserRelativeActivity(
      '2024-11-03T04:30:00.000Z',
      new Date('2024-11-04T05:30:00.000Z'),
      'America/New_York',
    ),
    'Вчера',
  );
  assert.equal(
    formatBrowserRelativeActivity(
      '2024-02-29T23:30:00.000Z',
      new Date('2024-03-01T12:00:00.000Z'),
      'UTC',
    ),
    'Вчера',
  );
});

void test('restores removed action focus to its folder, then nearest folder and refresh', async () => {
  const first = folder({ id: 'first', name: 'First', path: 'C:\\First' });
  const second = folder({ id: 'second', name: 'Second', path: 'C:\\Second' });
  const third = folder({ id: 'third', name: 'Third', path: 'C:\\Third' });
  const harness = await setup({
    beforeStart: (window) => window.document.body.classList.add('vscode-reduce-motion'),
  });
  try {
    harness.send(ready(1, [first, second, third]));
    const firstElement = folderElement(harness.document, 'first');
    (firstElement.querySelector('.folder-head') as HTMLButtonElement).click();
    const firstAction = firstElement.querySelector<HTMLButtonElement>('[data-action="openHere"]');
    assert.ok(firstAction);
    firstAction.focus();
    harness.send(ready(2, [{ ...first, current: true }, second, third]));
    assert.equal(harness.document.activeElement, firstElement.querySelector('.folder-head'));

    const secondElement = folderElement(harness.document, 'second');
    (secondElement.querySelector('.folder-head') as HTMLButtonElement).click();
    const secondAction = secondElement.querySelector<HTMLButtonElement>('[data-action="openHere"]');
    assert.ok(secondAction);
    secondAction.focus();
    harness.send(ready(3, [{ ...first, current: true }, third]));
    assert.equal(
      harness.document.activeElement,
      folderElement(harness.document, 'third').querySelector('.folder-head'),
    );

    (folderElement(harness.document, 'third').querySelector('.folder-head') as HTMLButtonElement).focus();
    harness.send(ready(4, []));
    assert.equal(harness.document.activeElement, harness.document.querySelector('.refresh'));
  } finally {
    harness.dispose();
  }
});

void test('renders 1000 folders in cancelable chunks with busy state before the heartbeat', async () => {
  const folders = Array.from({ length: 1_000 }, (_, index) => folder({
    id: `folder-${index}`,
    name: `Folder ${index}`,
    path: `C:\\Folder${index}`,
    conversations: [],
  }));
  const harness = await setup();
  try {
    harness.send({
      version: PROTOCOL_VERSION,
      revision: 1,
      kind: 'refreshing',
      folders,
      message: WEBVIEW_STATE_MESSAGES.refreshing,
      busy: true,
    });
    const hub = harness.document.querySelector<HTMLElement>('.hub');
    const refresh = harness.document.querySelector<HTMLButtonElement>('.refresh');
    assert.equal(hub?.getAttribute('aria-busy'), 'true');
    assert.equal(refresh?.disabled, true);
    assert.equal(harness.document.querySelector('.view-status')?.textContent, WEBVIEW_STATE_MESSAGES.refreshing);
    assert.equal(harness.document.querySelectorAll('.folder').length, 0);

    let foldersAtHeartbeat = -1;
    await new Promise<void>((resolve) => harness.window.setTimeout(() => {
      foldersAtHeartbeat = harness.document.querySelectorAll('.folder').length;
      resolve();
    }, 0));
    assert.ok(foldersAtHeartbeat >= 0 && foldersAtHeartbeat < 1_000);
    await waitFor(harness.window, () => harness.document.querySelectorAll('.folder').length === 1_000);
  } finally {
    harness.dispose();
  }
});

void test('a newer revision cancels a stale chunked render without leaking old folders', async () => {
  const staleFolders = Array.from({ length: 1_000 }, (_, index) => folder({
    id: `stale-${index}`,
    name: `Stale ${index}`,
    path: `C:\\Stale${index}`,
    conversations: [],
  }));
  const fresh = folder({ id: 'fresh', name: 'Fresh', path: 'C:\\Fresh' });
  const harness = await setup();
  try {
    harness.send(ready(1, staleFolders));
    await waitFor(harness.window, () => harness.document.querySelectorAll('.folder').length > 0);
    assert.ok(harness.document.querySelectorAll('.folder').length < 1_000);
    harness.send(ready(2, [fresh]));
    await waitFor(harness.window, () => (
      harness.document.querySelectorAll('.folder').length === 1
      && harness.document.querySelector('.folder')?.getAttribute('data-folder-id') === 'fresh'
    ));
    assert.equal(harness.document.querySelectorAll('.folder').length, 1);
    assert.equal(harness.document.querySelector('.folder')?.getAttribute('data-folder-id'), 'fresh');
    assert.equal(harness.document.body.textContent?.includes('Stale'), false);
  } finally {
    harness.dispose();
  }
});

void test('recomputes nonce stylesheet badge variables on theme mutation without messaging the host', async () => {
  const harness = await setup({
    beforeStart: (window) => {
      window.document.body.classList.add('vscode-light');
      window.document.documentElement.style.setProperty('--vscode-sideBar-background', 'rgb(255, 255, 255)');
    },
  });
  try {
    harness.send(ready(1, [folder({ colorSlot: 0 })]));
    const monogram = harness.document.querySelector<HTMLElement>('.mono');
    const themeStyle = harness.document.getElementById('kilo-hub-theme-style');
    assert.ok(monogram);
    assert.ok(themeStyle);
    assert.equal(monogram.classList.contains('kilo-color-0'), true);
    const lightRules = themeStyle.textContent;
    assert.match(lightRules, /\.kilo-color-0\{--folder-bg:rgb\(244, 222, 202\);--folder-fg:rgb\(/u);
    const messageCount = harness.api.messages.length;

    harness.document.body.classList.replace('vscode-light', 'vscode-dark');
    harness.document.documentElement.style.setProperty('--vscode-sideBar-background', 'rgb(0, 0, 0)');
    await Promise.resolve();
    await Promise.resolve();
    assert.notEqual(themeStyle.textContent, lightRules);
    assert.equal(harness.api.messages.length, messageCount);
    assert.match(themeStyle.textContent, /--folder-border:transparent/u);

    const info = harness.document.querySelector<HTMLElement>('.info');
    assert.ok(info);
    const tooltipId = info.getAttribute('aria-describedby');
    assert.ok(tooltipId);
    const tooltip = harness.document.getElementById(tooltipId);
    assert.ok(tooltip);
    let ownerLeft = 20;
    info.getBoundingClientRect = () => ({
      x: ownerLeft, y: 10, left: ownerLeft, top: 10, right: ownerLeft + 20, bottom: 30,
      width: 20, height: 20, toJSON: () => ({}),
    });
    tooltip.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40,
      width: 100, height: 40, toJSON: () => ({}),
    });
    info.dispatchEvent(
      new harness.window.PointerEvent('pointerover', { bubbles: true }) as unknown as Event,
    );
    assert.equal(tooltip.style.left, '20px');
    ownerLeft = 80;
    harness.document.documentElement.dataset.vscodeThemeId = 'changed-theme';
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tooltip.style.left, '80px');
  } finally {
    harness.dispose();
  }
});
