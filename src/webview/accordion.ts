export const ACCORDION_ANIMATION_MS = 320;
export const ACCORDION_EDGE_OFFSET = 40;

export interface AccordionItem {
  readonly header: HTMLElement;
  readonly panel: HTMLElement;
  readonly expanded?: boolean;
}

export interface AccordionControllerOptions {
  readonly environment?: Window;
  readonly scrollContainer?: HTMLElement;
  readonly reducedMotion?: () => boolean;
  readonly durationMs?: number;
  readonly now?: () => number;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly getRect?: (element: HTMLElement) => Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>;
  readonly getScrollHeight?: (element: HTMLElement) => number;
  readonly getMaxScrollTop?: (element: HTMLElement) => number;
  readonly edgeOffset?: number;
  readonly onExpandedChange?: (item: AccordionItem | null) => void;
}

interface HeightTransition {
  readonly item: AccordionItem;
  readonly from: number;
  readonly to: number;
}

interface RunningTransition {
  readonly startedAt: number;
  readonly duration: number;
  readonly anchor: AccordionItem;
  readonly heights: readonly HeightTransition[];
}

let nextPanelId = 1;

function allocatePanelId(document: Document): string {
  let id: string;
  do {
    id = `kilo-hub-details-${nextPanelId++}`;
  } while (document.getElementById(id) !== null);
  return id;
}

function cubicEaseOut(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function defaultReducedMotion(document: Document, environment: Window): boolean {
  if (document.body.classList.contains('vscode-reduce-motion')) {
    return true;
  }
  return typeof environment.matchMedia === 'function'
    && environment.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Coordinates a single-open accordion without queueing obsolete transitions. */
export class AccordionController {
  readonly #items: readonly AccordionItem[];
  readonly #environment: Window;
  readonly #scroller: HTMLElement;
  readonly #reducedMotion: () => boolean;
  readonly #duration: number;
  readonly #now: () => number;
  readonly #requestFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelFrame: (handle: number) => void;
  readonly #getRect: NonNullable<AccordionControllerOptions['getRect']>;
  readonly #getScrollHeight: NonNullable<AccordionControllerOptions['getScrollHeight']>;
  readonly #getMaxScrollTop: NonNullable<AccordionControllerOptions['getMaxScrollTop']>;
  readonly #edgeOffset: number;
  readonly #onExpandedChange: ((item: AccordionItem | null) => void) | undefined;
  readonly #listeners = new Map<AccordionItem, { click: EventListener; keydown: EventListener }>();
  #desired: AccordionItem | null;
  #running: RunningTransition | null = null;
  #frame: number | null = null;
  #settled: Promise<void> = Promise.resolve();
  #resolveSettled: (() => void) | null = null;
  #disposed = false;

  constructor(
    root: HTMLElement,
    items: readonly AccordionItem[],
    options: AccordionControllerOptions = {},
  ) {
    const environment = options.environment ?? root.ownerDocument.defaultView;
    if (environment === null) {
      throw new Error('AccordionController requires a document with a Window.');
    }

    this.#items = [...items];
    this.#environment = environment;
    this.#scroller = options.scrollContainer ?? root;
    this.#reducedMotion = options.reducedMotion
      ?? (() => defaultReducedMotion(root.ownerDocument, environment));
    this.#duration = Math.max(0, options.durationMs ?? ACCORDION_ANIMATION_MS);
    this.#now = options.now ?? (() => this.#environment.performance.now());
    this.#requestFrame = options.requestAnimationFrame
      ?? ((callback) => this.#environment.requestAnimationFrame(callback));
    this.#cancelFrame = options.cancelAnimationFrame
      ?? ((handle) => this.#environment.cancelAnimationFrame(handle));
    this.#getRect = options.getRect ?? ((element) => element.getBoundingClientRect());
    this.#getScrollHeight = options.getScrollHeight ?? ((element) => element.scrollHeight);
    this.#getMaxScrollTop = options.getMaxScrollTop
      ?? ((element) => Math.max(0, element.scrollHeight - element.clientHeight));
    this.#edgeOffset = options.edgeOffset ?? ACCORDION_EDGE_OFFSET;
    this.#onExpandedChange = options.onExpandedChange;

    const uniqueHeaders = new Set<HTMLElement>();
    const uniquePanels = new Set<HTMLElement>();
    let initial: AccordionItem | null = null;
    for (const item of this.#items) {
      if (!root.contains(item.header) || !root.contains(item.panel)) {
        throw new Error('Accordion headers and panels must be inside the controller root.');
      }
      if (uniqueHeaders.has(item.header) || uniquePanels.has(item.panel)) {
        throw new Error('Accordion headers and panels must be unique.');
      }
      uniqueHeaders.add(item.header);
      uniquePanels.add(item.panel);
      if (initial === null && (item.expanded === true || item.header.getAttribute('aria-expanded') === 'true')) {
        initial = item;
      }
    }
    this.#desired = initial;

    for (const item of this.#items) {
      if (item.panel.id.length === 0) {
        item.panel.id = allocatePanelId(item.panel.ownerDocument);
      }
      item.header.setAttribute('aria-controls', item.panel.id);
      this.#applySemantics(item, item === initial);
      item.panel.style.overflow = 'hidden';
      item.panel.style.height = item === initial ? 'auto' : '0px';

      const click: EventListener = () => {
        void this.toggle(item);
      };
      const keydown: EventListener = (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
          return;
        }
        keyboardEvent.preventDefault();
        void this.toggle(item);
      };
      item.header.addEventListener('click', click);
      item.header.addEventListener('keydown', keydown);
      this.#listeners.set(item, { click, keydown });
    }
  }

  get expanded(): AccordionItem | null {
    return this.#desired;
  }

  get settled(): Promise<void> {
    return this.#settled;
  }

  toggle(item: AccordionItem): Promise<void> {
    this.#assertItem(item);
    if (this.#disposed) {
      return Promise.resolve();
    }
    return this.#request(this.#desired === item ? null : item, item);
  }

  open(item: AccordionItem): Promise<void> {
    this.#assertItem(item);
    if (this.#disposed || this.#desired === item) {
      return this.#settled;
    }
    return this.#request(item, item);
  }

  close(item: AccordionItem | null = this.#desired): Promise<void> {
    if (item !== null) {
      this.#assertItem(item);
    }
    if (this.#disposed || item === null || this.#desired !== item) {
      return this.#settled;
    }
    return this.#request(null, item);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#frame !== null) {
      this.#cancelFrame(this.#frame);
      this.#frame = null;
    }
    this.#running = null;

    for (const [item, listeners] of this.#listeners) {
      item.header.removeEventListener('click', listeners.click);
      item.header.removeEventListener('keydown', listeners.keydown);
    }
    this.#listeners.clear();
    this.#finishSettledPromise();
  }

  #request(next: AccordionItem | null, anchor: AccordionItem): Promise<void> {
    if (this.#frame !== null) {
      this.#cancelFrame(this.#frame);
      this.#frame = null;
    }

    this.#ensureSettledPromise();
    this.#desired = next;
    this.#onExpandedChange?.(next);

    const anchorTop = this.#getRect(anchor.header).top;
    const heights: HeightTransition[] = [];
    for (const item of this.#items) {
      const opening = item === next;
      if (!opening) {
        this.#recoverFocus(item);
      }
      const from = this.#readCurrentHeight(item.panel);
      const to = opening ? Math.max(0, this.#getScrollHeight(item.panel)) : 0;
      this.#applySemantics(item, opening);
      item.panel.style.height = `${from}px`;
      heights.push({ item, from, to });
    }

    const duration = this.#reducedMotion() ? 0 : this.#duration;
    if (duration === 0 || heights.every(({ from, to }) => from === to)) {
      this.#finalizeHeights();
      this.#compensate(anchor, anchorTop);
      this.#correctViewportEdge(anchor);
      this.#finishSettledPromise();
      return this.#settled;
    }

    this.#running = {
      startedAt: this.#now(),
      duration,
      anchor,
      heights,
    };
    this.#frame = this.#requestFrame(this.#onAnimationFrame);
    return this.#settled;
  }

  readonly #onAnimationFrame: FrameRequestCallback = () => {
    this.#frame = null;
    const running = this.#running;
    if (running === null || this.#disposed) {
      return;
    }

    const progress = Math.min(1, Math.max(0, (this.#now() - running.startedAt) / running.duration));
    const eased = cubicEaseOut(progress);
    const anchorTop = this.#getRect(running.anchor.header).top;
    for (const height of running.heights) {
      const value = height.from + (height.to - height.from) * eased;
      height.item.panel.style.height = `${Math.max(0, value)}px`;
    }
    this.#compensate(running.anchor, anchorTop);

    if (progress < 1) {
      this.#frame = this.#requestFrame(this.#onAnimationFrame);
      return;
    }

    this.#running = null;
    this.#finalizeHeights();
    this.#correctViewportEdge(running.anchor);
    this.#finishSettledPromise();
  };

  #readCurrentHeight(panel: HTMLElement): number {
    if (panel.style.height.endsWith('px')) {
      const inlineHeight = Number.parseFloat(panel.style.height);
      if (Number.isFinite(inlineHeight)) {
        return Math.max(0, inlineHeight);
      }
    }

    const rendered = this.#getRect(panel).height;
    if (rendered > 0) {
      return rendered;
    }
    return panel.getAttribute('aria-hidden') === 'false'
      ? Math.max(0, this.#getScrollHeight(panel))
      : 0;
  }

  #applySemantics(item: AccordionItem, expanded: boolean): void {
    item.header.setAttribute('aria-expanded', String(expanded));
    item.panel.setAttribute('aria-hidden', String(!expanded));
    item.panel.inert = !expanded;
  }

  #recoverFocus(item: AccordionItem): void {
    const activeElement = item.panel.ownerDocument.activeElement;
    if (activeElement !== null && item.panel.contains(activeElement)) {
      item.header.focus({ preventScroll: true });
    }
  }

  #finalizeHeights(): void {
    for (const item of this.#items) {
      item.panel.style.height = item === this.#desired ? 'auto' : '0px';
    }
  }

  #compensate(anchor: AccordionItem, previousTop: number): void {
    const nextTop = this.#getRect(anchor.header).top;
    this.#adjustScroll(nextTop - previousTop);
  }

  #correctViewportEdge(anchor: AccordionItem): void {
    const viewport = this.#getRect(this.#scroller);
    const header = this.#getRect(anchor.header);
    if (header.top < viewport.top) {
      this.#adjustScroll(header.top - viewport.top);
      return;
    }
    if (header.bottom + this.#edgeOffset > viewport.bottom) {
      this.#adjustScroll(header.bottom + this.#edgeOffset - viewport.bottom);
    }
  }

  #adjustScroll(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const maximum = Math.max(0, this.#getMaxScrollTop(this.#scroller));
    this.#scroller.scrollTop = Math.min(maximum, Math.max(0, this.#scroller.scrollTop + delta));
  }

  #ensureSettledPromise(): void {
    if (this.#resolveSettled !== null) {
      return;
    }
    this.#settled = new Promise<void>((resolve) => {
      this.#resolveSettled = resolve;
    });
  }

  #finishSettledPromise(): void {
    const resolve = this.#resolveSettled;
    this.#resolveSettled = null;
    resolve?.();
  }

  #assertItem(item: AccordionItem): void {
    if (!this.#items.includes(item)) {
      throw new Error('Accordion item is not registered with this controller.');
    }
  }
}
