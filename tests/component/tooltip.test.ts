import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Window as HappyWindow } from 'happy-dom' with { 'resolution-mode': 'import' };

import {
  TOOLTIP_GRACE_MS,
  TooltipController,
} from '../../src/webview/tooltip.js';

class FakeTimers {
  #now = 0;
  #nextId = 1;
  readonly #timers = new Map<number, { readonly due: number; readonly callback: () => void }>();

  install(window: HappyWindow): void {
    Object.defineProperty(window, 'setTimeout', {
      configurable: true,
      value: (callback: () => void, delay = 0): number => {
        const id = this.#nextId++;
        this.#timers.set(id, { due: this.#now + delay, callback });
        return id;
      },
    });
    Object.defineProperty(window, 'clearTimeout', {
      configurable: true,
      value: (id: number): void => {
        this.#timers.delete(id);
      },
    });
  }

  tick(milliseconds: number): void {
    const target = this.#now + milliseconds;
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (next === undefined) {
        break;
      }
      this.#now = next[1].due;
      this.#timers.delete(next[0]);
      next[1].callback();
    }
    this.#now = target;
  }
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function pointerEvent(
  window: HappyWindow,
  type: string,
  relatedTarget: EventTarget | null = null,
  coordinates: { readonly clientX: number; readonly clientY: number } = { clientX: 0, clientY: 0 },
): PointerEvent {
  const event = new window.PointerEvent(type, { bubbles: true, ...coordinates });
  Object.defineProperty(event, 'relatedTarget', { configurable: true, value: relatedTarget });
  return event as unknown as PointerEvent;
}

async function setup(): Promise<{
  readonly window: HappyWindow;
  readonly panel: HTMLElement;
  readonly timers: FakeTimers;
}> {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://webview.test/' });
  const timers = new FakeTimers();
  timers.install(window);
  const rawPanel = window.document.createElement('main');
  window.document.body.append(rawPanel);
  const panel = rawPanel as unknown as HTMLElement;
  return { window, panel, timers };
}

void test('tooltip nodes and aria descriptions remain stable while only one popup is visible', async () => {
  const { window, panel } = await setup();
  const first = window.document.createElement('button') as unknown as HTMLElement;
  const firstChild = window.document.createElement('span') as unknown as HTMLElement;
  const secondChild = window.document.createElement('span') as unknown as HTMLElement;
  first.append(firstChild, secondChild);
  first.setAttribute('aria-describedby', 'existing-description');
  const second = window.document.createElement('button') as unknown as HTMLElement;
  panel.append(first, second);

  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
  });
  const firstRegistration = controller.register(first, 'Первый путь');
  const secondRegistration = controller.register(second, 'Второй путь');

  assert.notEqual(firstRegistration.tooltip.id, secondRegistration.tooltip.id);
  assert.equal(firstRegistration.tooltip.getAttribute('role'), 'tooltip');
  assert.equal(firstRegistration.tooltip.hasAttribute('tabindex'), false);
  assert.equal(firstRegistration.tooltip.querySelector('a, button, input'), null);
  assert.equal(
    first.getAttribute('aria-describedby'),
    `existing-description ${firstRegistration.tooltip.id}`,
  );

  firstChild.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(firstRegistration.tooltip.hidden, false);
  assert.equal(secondRegistration.tooltip.hidden, true);

  firstChild.dispatchEvent(pointerEvent(window, 'pointerout', secondChild));
  assert.equal(firstRegistration.tooltip.hidden, false, 'moving between owner descendants is stable');
  second.dispatchEvent(pointerEvent(window, 'pointerover', firstChild));
  assert.equal(firstRegistration.tooltip.hidden, true);
  assert.equal(secondRegistration.tooltip.hidden, false);
  assert.equal(first.getAttribute('aria-describedby')?.includes(firstRegistration.tooltip.id), true);

  controller.dispose();
  assert.equal(panel.querySelectorAll('[role="tooltip"]').length, 0);
  assert.equal(first.getAttribute('aria-describedby'), 'existing-description');
  assert.equal(second.hasAttribute('aria-describedby'), false);
});

void test('pointer entering popup geometry hides immediately and stays dismissed until owner reentry', async () => {
  const { window, panel, timers } = await setup();
  const owner = window.document.createElement('button') as unknown as HTMLElement;
  panel.append(owner);
  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
  });
  const { tooltip } = controller.register(owner, 'Длинное пояснение');
  tooltip.getBoundingClientRect = () => domRect(20, 30, 100, 50);

  assert.equal(TOOLTIP_GRACE_MS, 120);
  assert.equal(tooltip.style.pointerEvents, 'none');
  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(tooltip.hidden, false);

  owner.dispatchEvent(pointerEvent(window, 'pointerout'));
  (window.document.body as unknown as HTMLElement).dispatchEvent(pointerEvent(
    window,
    'pointermove',
    null,
    { clientX: 19, clientY: 30 },
  ));
  assert.equal(tooltip.hidden, false);
  (window.document.body as unknown as HTMLElement).dispatchEvent(pointerEvent(
    window,
    'pointermove',
    null,
    { clientX: 20, clientY: 30 },
  ));
  assert.equal(tooltip.hidden, true);

  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(tooltip.hidden, false, 'one real reentry clears dismissal after pointerout happened first');

  (window.document.body as unknown as HTMLElement).dispatchEvent(pointerEvent(
    window,
    'pointermove',
    null,
    { clientX: 20, clientY: 30 },
  ));
  assert.equal(tooltip.hidden, true);
  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(tooltip.hidden, true, 'underlying owner cannot revive a popup while hover remains active');
  owner.dispatchEvent(pointerEvent(window, 'pointerout'));
  timers.tick(120);
  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(tooltip.hidden, false, 'real leave and reentry clears dismissal');

  controller.dispose();
});

void test('Escape remains latched until pointer and focus have both left', async () => {
  const { window, panel, timers } = await setup();
  const owner = window.document.createElement('button') as unknown as HTMLElement;
  panel.append(owner);
  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
  });
  const { tooltip } = controller.register(owner, 'Описание');

  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  owner.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }) as unknown as FocusEvent);
  owner.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }) as unknown as Event);
  assert.equal(tooltip.hidden, true);

  owner.dispatchEvent(pointerEvent(window, 'pointerout'));
  timers.tick(120);
  assert.equal(tooltip.hidden, true);
  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(tooltip.hidden, true, 'remaining focus keeps the dismissal latch set');
  owner.dispatchEvent(pointerEvent(window, 'pointerout'));
  owner.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }) as unknown as FocusEvent);
  timers.tick(120);

  owner.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }) as unknown as FocusEvent);
  assert.equal(tooltip.hidden, false, 'a new interaction works after every prior state ended');
  controller.dispose();
});

void test('document Escape dismisses a hover-only tooltip and disposal removes the listener', async () => {
  const { window, panel } = await setup();
  const passive = window.document.createElement('span') as unknown as HTMLElement;
  panel.append(passive);
  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
  });
  const { tooltip } = controller.register(passive, 'Описание');

  passive.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(tooltip.hidden, false);
  const escape = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
  window.document.body.dispatchEvent(escape);
  assert.equal(tooltip.hidden, true);
  assert.equal(escape.defaultPrevented, true);

  controller.dispose();
  const afterDispose = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
  window.document.body.dispatchEvent(afterDispose);
  assert.equal(afterDispose.defaultPrevented, false);
});

void test('switching from geometrically dismissed popup to another focused owner cannot revive it', async () => {
  const { window, panel, timers } = await setup();
  const first = window.document.createElement('button') as unknown as HTMLElement;
  const second = window.document.createElement('button') as unknown as HTMLElement;
  panel.append(first, second);
  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
  });
  const firstRegistration = controller.register(first, 'Первый');
  const secondRegistration = controller.register(second, 'Второй');
  firstRegistration.tooltip.getBoundingClientRect = () => domRect(10, 10, 60, 30);

  first.dispatchEvent(pointerEvent(window, 'pointerover'));
  (window.document.body as unknown as HTMLElement).dispatchEvent(pointerEvent(
    window,
    'pointermove',
    null,
    { clientX: 40, clientY: 25 },
  ));
  second.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }) as unknown as FocusEvent);
  assert.equal(firstRegistration.tooltip.hidden, true);
  assert.equal(secondRegistration.tooltip.hidden, false);

  second.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }) as unknown as FocusEvent);
  timers.tick(TOOLTIP_GRACE_MS);
  assert.equal(secondRegistration.tooltip.hidden, true);
  assert.equal(firstRegistration.tooltip.hidden, true);
  controller.dispose();
});

void test('passive owners are hover-only and popup text updates safely', async () => {
  const { window, panel } = await setup();
  const passive = window.document.createElement('span') as unknown as HTMLElement;
  panel.append(passive);
  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
  });
  const registration = controller.register(passive, '<img src=x onerror=alert(1)>');

  passive.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }) as unknown as FocusEvent);
  assert.equal(registration.tooltip.hidden, true);
  passive.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(registration.tooltip.hidden, false);
  assert.equal(registration.tooltip.children.length, 0);
  assert.equal(registration.tooltip.textContent, '<img src=x onerror=alert(1)>');

  registration.update('<script>bad()</script>');
  assert.equal(registration.tooltip.children.length, 0);
  assert.equal(registration.tooltip.textContent, '<script>bad()</script>');
  controller.dispose();
});

void test('fixed positioning clamps long content and flips above at viewport edges', async () => {
  const { window, panel } = await setup();
  const owner = window.document.createElement('button') as unknown as HTMLElement;
  panel.append(owner);
  let viewport = { width: 300, height: 240 };
  owner.getBoundingClientRect = () => domRect(290, 180, 20, 20);
  const controller = new TooltipController(panel, {
    environment: window as unknown as globalThis.Window,
    viewport: () => viewport,
  });
  const registration = controller.register(owner, 'x'.repeat(2_000));
  registration.tooltip.getBoundingClientRect = () => domRect(0, 0, 200, 500);

  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(registration.tooltip.style.position, 'fixed');
  assert.equal(registration.tooltip.style.pointerEvents, 'none');
  assert.equal(registration.tooltip.style.maxWidth, '284px');
  assert.equal(registration.tooltip.style.maxHeight, 'none');
  assert.equal(registration.tooltip.style.left, '92px');
  assert.equal(registration.tooltip.style.top, '8px');
  assert.equal(registration.tooltip.style.overflow, 'visible');

  viewport = { width: 500, height: 600 };
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(registration.tooltip.style.maxWidth, '330px');
  assert.equal(registration.tooltip.style.left, '290px');
  assert.equal(registration.tooltip.style.top, '92px');

  controller.dispose();
  owner.dispatchEvent(pointerEvent(window, 'pointerover'));
  assert.equal(panel.querySelector('[role="tooltip"]'), null, 'disposed controllers do not react');
});
