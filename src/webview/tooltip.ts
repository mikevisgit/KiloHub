export const TOOLTIP_GRACE_MS = 120;
export const TOOLTIP_VIEWPORT_MARGIN = 8;
export const TOOLTIP_MAX_WIDTH = 330;

const TOOLTIP_GAP = 4;

export interface TooltipRegistrationOptions {
  readonly focusable?: boolean;
  readonly descriptionTarget?: HTMLElement;
}

export interface TooltipControllerOptions {
  readonly environment?: Window;
  readonly graceMs?: number;
  readonly viewport?: () => { readonly width: number; readonly height: number };
  readonly tooltipClassName?: string;
}

export interface TooltipRegistration {
  readonly owner: HTMLElement;
  readonly tooltip: HTMLElement;
  update(text: string): void;
  dispose(): void;
}

interface TooltipEntry {
  readonly owner: HTMLElement;
  readonly tooltip: HTMLElement;
  readonly focusable: boolean;
  readonly descriptionTarget: HTMLElement;
  readonly originalDescription: string | null;
  sourceHovered: boolean;
  sourceFocused: boolean;
  dismissed: boolean;
  activity: number;
}

let nextTooltipId = 1;

function isNaturallyFocusable(element: HTMLElement): boolean {
  if (element.matches('button, input, select, textarea')) {
    return !element.matches(':disabled');
  }

  if (element.matches('a[href], area[href], iframe, object, embed')) {
    return true;
  }

  return element.tabIndex >= 0;
}

function allocateTooltipId(document: Document): string {
  let id: string;
  do {
    id = `kilo-hub-tooltip-${nextTooltipId++}`;
  } while (document.getElementById(id) !== null);
  return id;
}

function addDescriptionToken(value: string | null, token: string): string {
  const tokens = value?.split(/\s+/u).filter(Boolean) ?? [];
  if (!tokens.includes(token)) {
    tokens.push(token);
  }
  return tokens.join(' ');
}

/** Owns all tooltip state for one Webview surface. */
export class TooltipController {
  readonly #panel: HTMLElement;
  readonly #environment: Window;
  readonly #graceMs: number;
  readonly #viewport: () => { readonly width: number; readonly height: number };
  readonly #tooltipClassName: string;
  readonly #owners = new Map<HTMLElement, TooltipEntry>();
  #visible: TooltipEntry | null = null;
  #hideTimer: number | null = null;
  #activity = 0;
  #disposed = false;

  readonly #onPointerOver = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    const owner = this.#findOwner(pointerEvent.target);
    if (owner === null || this.#findOwner(pointerEvent.relatedTarget) === owner) {
      return;
    }

    for (const entry of this.#owners.values()) {
      if (entry !== owner) {
        entry.sourceHovered = false;
        this.#resetDismissalWhenInactive(entry);
      }
    }
    const wasInactive = !this.#isInteracting(owner);
    owner.sourceHovered = true;
    if (wasInactive) {
      owner.dismissed = false;
    }
    this.#activate(owner);
  };

  readonly #onPointerOut = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    const owner = this.#findOwner(pointerEvent.target);
    if (owner === null || this.#findOwner(pointerEvent.relatedTarget) === owner) {
      return;
    }

    owner.sourceHovered = false;
    const nextOwner = this.#findOwner(pointerEvent.relatedTarget);
    if (nextOwner !== null) {
      nextOwner.sourceHovered = true;
      this.#activate(nextOwner);
    } else {
      this.#afterInteractionChanged(owner);
    }
  };

  readonly #onFocusIn = (event: Event): void => {
    const owner = this.#findOwner(event.target);
    if (owner === null || !owner.focusable) {
      return;
    }
    owner.sourceFocused = true;
    this.#activate(owner);
  };

  readonly #onFocusOut = (event: Event): void => {
    const focusEvent = event as FocusEvent;
    const owner = this.#findOwner(focusEvent.target);
    if (owner === null || !owner.focusable || this.#findOwner(focusEvent.relatedTarget) === owner) {
      return;
    }
    owner.sourceFocused = false;
    this.#afterInteractionChanged(owner);
  };

  readonly #onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== 'Escape' || this.#visible === null) {
      return;
    }

    this.#visible.dismissed = true;
    this.#cancelHide();
    this.#hideVisible();
    keyboardEvent.preventDefault();
  };

  readonly #onPointerMove = (event: Event): void => {
    const entry = this.#visible;
    if (entry === null || entry.tooltip.hidden) {
      return;
    }

    const pointerEvent = event as PointerEvent;
    const rect = entry.tooltip.getBoundingClientRect();
    if (
      (rect.width > 0 || rect.height > 0)
      && pointerEvent.clientX >= rect.left
      && pointerEvent.clientX <= rect.right
      && pointerEvent.clientY >= rect.top
      && pointerEvent.clientY <= rect.bottom
    ) {
      entry.dismissed = true;
      this.#cancelHide();
      this.#hideVisible();
    }
  };

  readonly #onViewportChanged = (): void => {
    this.reposition();
  };

  constructor(panel: HTMLElement, options: TooltipControllerOptions = {}) {
    const environment = options.environment ?? panel.ownerDocument.defaultView;
    if (environment === null) {
      throw new Error('TooltipController requires a document with a Window.');
    }

    this.#panel = panel;
    this.#environment = environment;
    this.#graceMs = options.graceMs ?? TOOLTIP_GRACE_MS;
    this.#tooltipClassName = options.tooltipClassName ?? 'tooltip';
    this.#viewport = options.viewport ?? (() => ({
      width: this.#environment.innerWidth || this.#panel.ownerDocument.documentElement.clientWidth,
      height: this.#environment.innerHeight || this.#panel.ownerDocument.documentElement.clientHeight,
    }));

    panel.addEventListener('pointerover', this.#onPointerOver);
    panel.addEventListener('pointerout', this.#onPointerOut);
    panel.addEventListener('focusin', this.#onFocusIn);
    panel.addEventListener('focusout', this.#onFocusOut);
    panel.ownerDocument.addEventListener('keydown', this.#onKeyDown);
    panel.ownerDocument.addEventListener('pointermove', this.#onPointerMove, true);
    panel.addEventListener('scroll', this.#onViewportChanged, true);
    environment.addEventListener('scroll', this.#onViewportChanged, true);
    environment.addEventListener('resize', this.#onViewportChanged);
  }

  register(
    owner: HTMLElement,
    text: string,
    options: TooltipRegistrationOptions = {},
  ): TooltipRegistration {
    this.#assertActive();
    if (!this.#panel.contains(owner)) {
      throw new Error('Tooltip owner must be inside the controller panel.');
    }
    if (this.#owners.has(owner)) {
      throw new Error('Tooltip owner is already registered.');
    }
    const descriptionTarget = options.descriptionTarget ?? owner;
    if (!this.#panel.contains(descriptionTarget)) {
      throw new Error('Tooltip description target must be inside the controller panel.');
    }

    const tooltip = owner.ownerDocument.createElement('div');
    tooltip.id = allocateTooltipId(owner.ownerDocument);
    tooltip.className = this.#tooltipClassName;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    tooltip.textContent = text;
    tooltip.style.position = 'fixed';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.overflow = 'visible';
    tooltip.style.overflowWrap = 'anywhere';
    tooltip.style.width = 'max-content';

    const originalDescription = descriptionTarget.getAttribute('aria-describedby');
    descriptionTarget.setAttribute('aria-describedby', addDescriptionToken(originalDescription, tooltip.id));
    this.#panel.append(tooltip);

    const entry: TooltipEntry = {
      owner,
      tooltip,
      focusable: options.focusable ?? isNaturallyFocusable(owner),
      descriptionTarget,
      originalDescription,
      sourceHovered: false,
      sourceFocused: false,
      dismissed: false,
      activity: 0,
    };
    this.#owners.set(owner, entry);

    let registered = true;
    return {
      owner,
      tooltip,
      update: (nextText: string): void => {
        if (!registered || this.#disposed) {
          return;
        }
        tooltip.textContent = nextText;
        if (this.#visible === entry) {
          this.reposition();
        }
      },
      dispose: (): void => {
        if (!registered) {
          return;
        }
        registered = false;
        this.#unregister(entry);
      },
    };
  }

  reposition(): void {
    const entry = this.#visible;
    if (entry === null || entry.tooltip.hidden || this.#disposed) {
      return;
    }

    const viewport = this.#viewport();
    const width = Math.max(0, viewport.width);
    const height = Math.max(0, viewport.height);
    const widthLimit = Math.max(0, Math.min(TOOLTIP_MAX_WIDTH, width - TOOLTIP_VIEWPORT_MARGIN * 2));
    const tooltip = entry.tooltip;
    tooltip.style.maxWidth = `${widthLimit}px`;
    tooltip.style.maxHeight = 'none';

    const ownerRect = entry.owner.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const measuredWidth = Math.min(
      widthLimit,
      tooltipRect.width || tooltip.offsetWidth || tooltip.scrollWidth || widthLimit,
    );
    const measuredHeight = tooltipRect.height || tooltip.offsetHeight || tooltip.scrollHeight;
    const spaceBelow = Math.max(
      0,
      height - TOOLTIP_VIEWPORT_MARGIN - ownerRect.bottom - TOOLTIP_GAP,
    );
    const spaceAbove = Math.max(
      0,
      ownerRect.top - TOOLTIP_VIEWPORT_MARGIN - TOOLTIP_GAP,
    );
    const useAbove = measuredHeight > spaceBelow && spaceAbove > spaceBelow;
    const renderedHeight = measuredHeight;
    const renderedWidth = Math.min(
      widthLimit,
      tooltipRect.width || tooltip.offsetWidth || tooltip.scrollWidth || measuredWidth,
    );
    const maximumLeft = Math.max(TOOLTIP_VIEWPORT_MARGIN, width - TOOLTIP_VIEWPORT_MARGIN - renderedWidth);
    const desiredTop = useAbove
      ? ownerRect.top - TOOLTIP_GAP - renderedHeight
      : ownerRect.bottom + TOOLTIP_GAP;
    const maximumTop = Math.max(TOOLTIP_VIEWPORT_MARGIN, height - TOOLTIP_VIEWPORT_MARGIN - renderedHeight);

    tooltip.style.left = `${Math.min(Math.max(ownerRect.left, TOOLTIP_VIEWPORT_MARGIN), maximumLeft)}px`;
    tooltip.style.top = `${Math.min(Math.max(desiredTop, TOOLTIP_VIEWPORT_MARGIN), maximumTop)}px`;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#cancelHide();
    this.#panel.removeEventListener('pointerover', this.#onPointerOver);
    this.#panel.removeEventListener('pointerout', this.#onPointerOut);
    this.#panel.removeEventListener('focusin', this.#onFocusIn);
    this.#panel.removeEventListener('focusout', this.#onFocusOut);
    this.#panel.ownerDocument.removeEventListener('keydown', this.#onKeyDown);
    this.#panel.ownerDocument.removeEventListener('pointermove', this.#onPointerMove, true);
    this.#panel.removeEventListener('scroll', this.#onViewportChanged, true);
    this.#environment.removeEventListener('scroll', this.#onViewportChanged, true);
    this.#environment.removeEventListener('resize', this.#onViewportChanged);

    for (const entry of [...this.#owners.values()]) {
      this.#unregister(entry);
    }
    this.#visible = null;
  }

  #activate(entry: TooltipEntry): void {
    this.#cancelHide();
    this.#resetDismissalWhenInactive(entry);
    entry.activity = ++this.#activity;
    if (entry.dismissed || !this.#isInteracting(entry)) {
      return;
    }

    if (this.#visible !== entry) {
      this.#hideVisible();
      this.#visible = entry;
      entry.tooltip.hidden = false;
    }
    this.reposition();
  }

  #afterInteractionChanged(entry: TooltipEntry): void {
    this.#resetDismissalWhenInactive(entry);
    if (this.#isInteracting(entry) && !entry.dismissed) {
      this.#activate(entry);
      return;
    }
    if (this.#visible !== entry) {
      return;
    }

    this.#cancelHide();
    if (this.#graceMs === 0 && !this.#isInteracting(entry)) {
      this.#hideVisible();
      this.#showMostRecentInteractingEntry();
      return;
    }
    this.#hideTimer = this.#environment.setTimeout(() => {
      this.#hideTimer = null;
      if (this.#visible === entry && !this.#isInteracting(entry)) {
        this.#hideVisible();
        this.#showMostRecentInteractingEntry();
      }
    }, this.#graceMs);
  }

  #showMostRecentInteractingEntry(): void {
    let candidate: TooltipEntry | null = null;
    for (const entry of this.#owners.values()) {
      this.#resetDismissalWhenInactive(entry);
      if (
        this.#isInteracting(entry)
        && !entry.dismissed
        && (candidate === null || entry.activity > candidate.activity)
      ) {
        candidate = entry;
      }
    }
    if (candidate !== null) {
      this.#activate(candidate);
    }
  }

  #findOwner(target: EventTarget | null): TooltipEntry | null {
    let element = this.#asElement(target);
    while (element !== null && this.#panel.contains(element)) {
      const entry = this.#owners.get(element as HTMLElement);
      if (entry !== undefined) {
        return entry;
      }
      element = element.parentElement;
    }
    return null;
  }

  #asElement(target: EventTarget | null): Element | null {
    if (target === null || typeof (target as Element).parentElement === 'undefined') {
      return null;
    }
    return target as Element;
  }

  #isInteracting(entry: TooltipEntry): boolean {
    return entry.sourceHovered || entry.sourceFocused;
  }

  #resetDismissalWhenInactive(entry: TooltipEntry): void {
    if (!this.#isInteracting(entry)) {
      entry.dismissed = false;
    }
  }

  #hideVisible(): void {
    if (this.#visible !== null) {
      this.#visible.tooltip.hidden = true;
      this.#visible = null;
    }
  }

  #cancelHide(): void {
    if (this.#hideTimer !== null) {
      this.#environment.clearTimeout(this.#hideTimer);
      this.#hideTimer = null;
    }
  }

  #unregister(entry: TooltipEntry): void {
    if (!this.#owners.delete(entry.owner)) {
      return;
    }
    if (this.#visible === entry) {
      this.#hideVisible();
    }
    if (entry.originalDescription === null) {
      entry.descriptionTarget.removeAttribute('aria-describedby');
    } else {
      entry.descriptionTarget.setAttribute('aria-describedby', entry.originalDescription);
    }
    entry.tooltip.remove();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('TooltipController has been disposed.');
    }
  }
}
