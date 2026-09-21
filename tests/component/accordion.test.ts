import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Window as HappyWindow } from 'happy-dom' with { 'resolution-mode': 'import' };

import {
  ACCORDION_ANIMATION_MS,
  AccordionController,
  type AccordionItem,
} from '../../src/webview/accordion.js';

class FakeAnimationClock {
  now = 0;
  #nextId = 1;
  readonly #callbacks = new Map<number, FrameRequestCallback>();

  request = (callback: FrameRequestCallback): number => {
    const id = this.#nextId++;
    this.#callbacks.set(id, callback);
    return id;
  };

  cancel = (id: number): void => {
    this.#callbacks.delete(id);
  };

  step(milliseconds: number): void {
    this.now += milliseconds;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) {
      callback(this.now);
    }
  }

  get pending(): number {
    return this.#callbacks.size;
  }
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
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

async function createFixture(count = 2): Promise<{
  readonly window: HappyWindow;
  readonly root: HTMLElement;
  readonly items: AccordionItem[];
  readonly naturalHeights: Map<HTMLElement, number>;
}> {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://webview.test/' });
  const rawRoot = window.document.createElement('section');
  window.document.body.append(rawRoot);
  const root = rawRoot as unknown as HTMLElement;
  const items: AccordionItem[] = [];
  const naturalHeights = new Map<HTMLElement, number>();
  for (let index = 0; index < count; index += 1) {
    const header = window.document.createElement('button') as unknown as HTMLElement;
    header.textContent = `Folder ${index + 1}`;
    const panel = window.document.createElement('div') as unknown as HTMLElement;
    const action = window.document.createElement('button') as unknown as HTMLElement;
    action.textContent = 'Action';
    panel.append(action);
    root.append(header, panel);
    items.push({ header, panel });
    naturalHeights.set(panel, 100 + index * 20);
  }
  return { window, root, items, naturalHeights };
}

function heightOf(element: HTMLElement, naturalHeights: Map<HTMLElement, number>): number {
  if (element.style.height === 'auto') {
    return naturalHeights.get(element) ?? 0;
  }
  return Number.parseFloat(element.style.height) || 0;
}

void test('accordion exposes exact aria/inert states, allows only one item, and repeats close', async () => {
  const { window, root, items, naturalHeights } = await createFixture();
  const changes: Array<AccordionItem | null> = [];
  const controller = new AccordionController(root, items, {
    environment: window as unknown as globalThis.Window,
    reducedMotion: () => true,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
    onExpandedChange: (item) => changes.push(item),
  });

  assert.equal(ACCORDION_ANIMATION_MS, 320);
  for (const item of items) {
    assert.equal(item.header.getAttribute('aria-controls'), item.panel.id);
    assert.equal(item.header.getAttribute('aria-expanded'), 'false');
    assert.equal(item.panel.getAttribute('aria-hidden'), 'true');
    assert.equal(item.panel.inert, true);
    assert.equal(item.panel.style.height, '0px');
  }

  items[0].header.click();
  assert.equal(controller.expanded, items[0]);
  assert.equal(items[0].header.getAttribute('aria-expanded'), 'true');
  assert.equal(items[0].panel.getAttribute('aria-hidden'), 'false');
  assert.equal(items[0].panel.inert, false);
  assert.equal(items[0].panel.style.height, 'auto');

  items[1].header.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: ' ' }) as unknown as Event);
  assert.equal(controller.expanded, items[1]);
  assert.equal(items[0].header.getAttribute('aria-expanded'), 'false');
  assert.equal(items[0].panel.inert, true);
  assert.equal(items[1].header.getAttribute('aria-expanded'), 'true');

  items[1].header.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }) as unknown as Event);
  assert.equal(controller.expanded, null);
  assert.deepEqual(changes, [items[0], items[1], null]);
  controller.dispose();
});

void test('rapid intent cancels and reverses the live cubic transition instead of queueing cycles', async () => {
  const { window, root, items, naturalHeights } = await createFixture();
  const clock = new FakeAnimationClock();
  const controller = new AccordionController(root, items, {
    environment: window as unknown as globalThis.Window,
    reducedMotion: () => false,
    now: () => clock.now,
    requestAnimationFrame: clock.request,
    cancelAnimationFrame: clock.cancel,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
  });

  void controller.toggle(items[0]);
  assert.equal(clock.pending, 1);
  clock.step(160);
  assert.equal(Number.parseFloat(items[0].panel.style.height), 87.5, 'cubic ease-out at half time');

  const latest = controller.toggle(items[0]);
  assert.equal(clock.pending, 1, 'the obsolete frame was cancelled');
  assert.equal(items[0].header.getAttribute('aria-expanded'), 'false');
  clock.step(160);
  assert.equal(Number.parseFloat(items[0].panel.style.height), 10.9375);
  clock.step(160);
  await latest;
  assert.equal(controller.expanded, null);
  assert.equal(items[0].panel.style.height, '0px');

  void controller.toggle(items[0]);
  clock.step(80);
  void controller.toggle(items[1]);
  clock.step(80);
  const finalIntent = controller.toggle(items[1]);
  assert.equal(clock.pending, 1);
  clock.step(320);
  await finalIntent;
  assert.equal(controller.expanded, null, 'A to B to B preserves the final close intent');
  assert.equal(items[0].panel.style.height, '0px');
  assert.equal(items[1].panel.style.height, '0px');
  controller.dispose();
});

void test('closing a detail containing focus restores focus before making it inert', async () => {
  const { window, root, items, naturalHeights } = await createFixture(1);
  const controller = new AccordionController(root, items, {
    environment: window as unknown as globalThis.Window,
    reducedMotion: () => true,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
  });
  void controller.open(items[0]);
  const action = items[0].panel.querySelector('button');
  assert.ok(action);
  action.focus();
  assert.equal(window.document.activeElement, action);

  void controller.close(items[0]);
  assert.equal(window.document.activeElement, items[0].header);
  assert.equal(items[0].panel.inert, true);
  assert.equal(items[0].panel.getAttribute('aria-hidden'), 'true');
  controller.dispose();
});

void test('reduced motion is evaluated for every intent and retains scroll edge correction', async () => {
  const { window, root, items, naturalHeights } = await createFixture(1);
  let reduced = true;
  root.scrollTop = 50;
  const controller = new AccordionController(root, items, {
    environment: window as unknown as globalThis.Window,
    reducedMotion: () => reduced,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
    getMaxScrollTop: () => 500,
    getRect: (element) => {
      if (element === root) {
        return rect(0, 0, 200, 100);
      }
      if (element === items[0].header) {
        return rect(0, 140 - root.scrollTop, 200, 20);
      }
      return rect(0, 0, 200, heightOf(element, naturalHeights));
    },
  });

  void controller.open(items[0]);
  assert.equal(items[0].panel.style.height, 'auto');
  assert.equal(root.scrollTop, 100, 'only the missing bottom distance is corrected');

  reduced = false;
  void controller.close(items[0]);
  assert.notEqual(items[0].panel.style.height, '0px', 'the next intent observes the new predicate');
  controller.dispose();
});

void test('scroll compensation holds the selected header while another long panel collapses', async () => {
  const { window, root, items, naturalHeights } = await createFixture();
  const clock = new FakeAnimationClock();
  naturalHeights.set(items[0].panel, 100);
  naturalHeights.set(items[1].panel, 900);
  const configuredItems: AccordionItem[] = [
    { ...items[0], expanded: true },
    items[1],
  ];
  root.scrollTop = 100;
  const controller = new AccordionController(root, configuredItems, {
    environment: window as unknown as globalThis.Window,
    scrollContainer: root,
    reducedMotion: () => false,
    now: () => clock.now,
    requestAnimationFrame: clock.request,
    cancelAnimationFrame: clock.cancel,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
    getMaxScrollTop: () => 2_000,
    getRect: (element) => {
      if (element === root) {
        return rect(0, 0, 240, 200);
      }
      if (element === configuredItems[0].header) {
        return rect(0, -root.scrollTop, 240, 30);
      }
      if (element === configuredItems[1].header) {
        const contentTop = 50 + heightOf(configuredItems[0].panel, naturalHeights);
        return rect(0, contentTop - root.scrollTop, 240, 30);
      }
      return rect(0, 0, 240, heightOf(element, naturalHeights));
    },
  });

  const selectedTop = configuredItems[1].header.getBoundingClientRect().top;
  const settled = controller.open(configuredItems[1]);
  clock.step(160);
  assert.equal(Number.parseFloat(configuredItems[1].panel.style.height), 787.5);
  clock.step(160);
  await settled;
  assert.equal(root.scrollTop, 0, 'the list edge limits compensation');
  assert.equal(configuredItems[1].panel.style.height, 'auto', 'long content finishes at auto height');
  assert.equal(controller.expanded, configuredItems[1]);
  assert.equal(selectedTop, 0, 'the setup starts at the top edge after initial scroll');
  controller.dispose();
});

void test('top edge correction is minimal and scroll clamping respects the list boundary', async () => {
  const { window, root, items, naturalHeights } = await createFixture(1);
  root.scrollTop = 50;
  const controller = new AccordionController(root, items, {
    environment: window as unknown as globalThis.Window,
    reducedMotion: () => true,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
    getMaxScrollTop: () => 80,
    getRect: (element) => {
      if (element === root) {
        return rect(0, 0, 200, 100);
      }
      if (element === items[0].header) {
        return rect(0, 30 - root.scrollTop, 200, 20);
      }
      return rect(0, 0, 200, heightOf(element, naturalHeights));
    },
  });

  void controller.open(items[0]);
  assert.equal(root.scrollTop, 30, 'header above the viewport receives only a 20px correction');
  controller.dispose();
});

void test('dispose cancels animation, settles waiters, and removes input listeners', async () => {
  const { window, root, items, naturalHeights } = await createFixture(1);
  const clock = new FakeAnimationClock();
  const controller = new AccordionController(root, items, {
    environment: window as unknown as globalThis.Window,
    reducedMotion: () => false,
    now: () => clock.now,
    requestAnimationFrame: clock.request,
    cancelAnimationFrame: clock.cancel,
    getScrollHeight: (panel) => naturalHeights.get(panel) ?? 0,
  });

  const pending = controller.open(items[0]);
  assert.equal(clock.pending, 1);
  controller.dispose();
  await pending;
  assert.equal(clock.pending, 0);
  const stateAtDispose = items[0].header.getAttribute('aria-expanded');
  items[0].header.click();
  assert.equal(items[0].header.getAttribute('aria-expanded'), stateAtDispose);
  assert.equal(controller.expanded, items[0]);
});
