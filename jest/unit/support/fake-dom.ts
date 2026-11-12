/**
 * REQ-242 — a small DOM for jest's node environment, just enough of one for the demo mirror's
 * recorder (the customer's side) and replayer (the stage's side) to run on: nodes that MOVE when
 * re-inserted (as the real DOM's do), attributes in insertion order, form state that is a
 * property (never an attribute, as in a browser), scroll offsets, boxes, canvases, a
 * MutationObserver that queues a record for every change under the document (delivered through
 * `takeRecords()`, as the recorder's flush reads them), event listeners, and `elementFromPoint`.
 *
 * Not a browser: no layout, no CSS, no live NodeLists — `childNodes` is an array.
 */

export const XHTML = "http://www.w3.org/1999/xhtml";
export const SVG = "http://www.w3.org/2000/svg";

export interface FakeRecord {
  type: "childList" | "attributes" | "characterData";
  target: FNode;
  addedNodes: FNode[];
  removedNodes: FNode[];
  attributeName: string | null;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class FNode {
  parentNode: FNode | null = null;
  childNodes: FNode[] = [];
  constructor(
    public ownerDocument: FDocument,
    public nodeType: number,
    public nodeName: string,
  ) {}

  get parentElement(): FElement | null {
    return this.parentNode && this.parentNode.nodeType === 1
      ? this.parentNode as FElement
      : null;
  }
  get firstChild(): FNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): FNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  get isConnected(): boolean {
    // deno-lint-ignore no-this-alias
    let n: FNode = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === 9;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v) this.appendChild(this.ownerDocument.createTextNode(v));
  }
  contains(other: FNode | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  appendChild<T extends FNode>(c: T): T {
    return this.insertBefore(c, null);
  }
  insertBefore<T extends FNode>(c: T, ref: FNode | null): T {
    if (c.contains(this)) throw new Error("HierarchyRequestError");
    if (c.parentNode) c.parentNode.removeChild(c);
    const at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    if (at < 0) throw new Error("NotFoundError: ref is not a child");
    this.childNodes.splice(at, 0, c);
    c.parentNode = this;
    this.ownerDocument.record({
      type: "childList",
      target: this,
      addedNodes: [c],
      removedNodes: [],
      attributeName: null,
    });
    return c;
  }
  removeChild<T extends FNode>(c: T): T {
    const at = this.childNodes.indexOf(c);
    if (at < 0) throw new Error("NotFoundError: not a child");
    // the record is taken while the parent is still where it was
    this.ownerDocument.record({
      type: "childList",
      target: this,
      addedNodes: [],
      removedNodes: [c],
      attributeName: null,
    });
    this.childNodes.splice(at, 1);
    c.parentNode = null;
    return c;
  }
  replaceChild<T extends FNode>(c: FNode, old: T): T {
    this.insertBefore(c, old);
    return this.removeChild(old);
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

export class FCharacterData extends FNode {
  #data: string;
  constructor(doc: FDocument, type: number, name: string, data: string) {
    super(doc, type, name);
    this.#data = data;
  }
  get data(): string {
    return this.#data;
  }
  set data(v: string) {
    this.#data = v;
    this.ownerDocument.record({
      type: "characterData",
      target: this,
      addedNodes: [],
      removedNodes: [],
      attributeName: null,
    });
  }
  override get textContent(): string {
    return this.nodeType === 3 ? this.#data : "";
  }
}

const FORM = new Set(["input", "textarea", "select"]);

export class FElement extends FNode {
  #attrs = new Map<string, string>();
  #value: string | null = null;
  #checked: boolean | null = null;
  scrollTop = 0;
  scrollLeft = 0;
  rect: Box = { left: 0, top: 0, width: 0, height: 0 };
  /** a canvas's bitmap, as its data URL (the recorder samples it) */
  bitmap = "data:image/png;base64,AAAA";
  /** what the replayer painted on this canvas */
  painted: string | null = null;
  constructor(
    doc: FDocument,
    public localName: string,
    public namespaceURI: string,
  ) {
    super(doc, 1, namespaceURI === XHTML ? localName.toUpperCase() : localName);
  }
  get tagName(): string {
    return this.nodeName;
  }
  get attributes(): { name: string; value: string }[] {
    return [...this.#attrs].map(([name, value]) => ({ name, value }));
  }
  getAttribute(n: string): string | null {
    return this.#attrs.get(n) ?? null;
  }
  hasAttribute(n: string): boolean {
    return this.#attrs.has(n);
  }
  setAttribute(n: string, v: string): void {
    if (!/^[^\s"'>/=]+$/.test(n)) throw new Error("InvalidCharacterError");
    this.#attrs.set(n, String(v));
    this.#canvasReset(n);
    this.ownerDocument.record({
      type: "attributes",
      target: this,
      addedNodes: [],
      removedNodes: [],
      attributeName: n,
    });
  }
  setAttributeNS(_ns: string | null, n: string, v: string): void {
    this.setAttribute(n, v);
  }
  removeAttribute(n: string): void {
    if (!this.#attrs.has(n)) return;
    this.#attrs.delete(n);
    this.#canvasReset(n);
    this.ownerDocument.record({
      type: "attributes",
      target: this,
      addedNodes: [],
      removedNodes: [],
      attributeName: n,
    });
  }
  /** REQ-380 — like a real canvas: setting (or removing) its width or height, even to the value it
   *  had, clears the bitmap — what the replay painted on it is gone */
  #canvasReset(n: string): void {
    if (this.localName === "canvas" && (n === "width" || n === "height")) {
      this.painted = null;
    }
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  get type(): string {
    return (this.getAttribute("type") ?? "text").toLowerCase();
  }
  /** form state: a property, never reflected back to the attribute */
  get value(): string {
    if (this.#value !== null) return this.#value;
    if (this.localName === "textarea") return this.textContent;
    if (this.localName === "select") {
      const opts = this.childNodes.filter((c) =>
        c.nodeType === 1 && (c as FElement).localName === "option"
      ) as FElement[];
      const sel = opts.find((o) => o.hasAttribute("selected")) ?? opts[0];
      return sel ? (sel.getAttribute("value") ?? sel.textContent) : "";
    }
    return this.getAttribute("value") ?? "";
  }
  set value(v: string) {
    if (!FORM.has(this.localName)) return;
    this.#value = String(v);
  }
  get checked(): boolean {
    return this.#checked ?? this.hasAttribute("checked");
  }
  set checked(v: boolean) {
    this.#checked = Boolean(v);
  }
  get width(): number {
    return Number(this.getAttribute("width") ?? 300);
  }
  get height(): number {
    return Number(this.getAttribute("height") ?? 150);
  }
  getBoundingClientRect() {
    const r = this.rect;
    return {
      ...r,
      x: r.left,
      y: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
    };
  }
  toDataURL(): string {
    return this.bitmap;
  }
}

/** REQ-547 — a constructed stylesheet (what the replay adopts to hold the frame still) */
export class FCSSStyleSheet {
  cssText = "";
  replaceSync(text: string): void {
    this.cssText = text;
  }
}

export class FWindow {
  /** REQ-547 — constructed stylesheets, as a browser window has them */
  CSSStyleSheet = FCSSStyleSheet;
  innerWidth: number;
  innerHeight: number;
  scrollX = 0;
  scrollY = 0;
  location: { href: string; pathname: string; search: string };
  #listeners = new Map<string, Set<(e: unknown) => void>>();
  constructor(href: string, w: number, h: number) {
    this.innerWidth = w;
    this.innerHeight = h;
    this.location = { href: "", pathname: "", search: "" };
    this.go(href);
  }
  /** pushState / replaceState: the URL changes, the document stays */
  go(href: string): void {
    const u = new URL(href);
    this.location = { href: u.href, pathname: u.pathname, search: u.search };
  }
  addEventListener(t: string, fn: (e: unknown) => void): void {
    if (!this.#listeners.has(t)) this.#listeners.set(t, new Set());
    this.#listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: (e: unknown) => void): void {
    this.#listeners.get(t)?.delete(fn);
  }
  fire(t: string): void {
    for (const fn of this.#listeners.get(t) ?? []) {
      fn({ type: t, target: this });
    }
  }
  listening(t: string): number {
    return this.#listeners.get(t)?.size ?? 0;
  }
}

export class FakeMutationObserver {
  queue: FakeRecord[] = [];
  #doc: FDocument | null = null;
  constructor(public cb: (records: FakeRecord[]) => void) {}
  observe(target: FNode): void {
    this.#doc = target.nodeType === 9
      ? target as FDocument
      : target.ownerDocument;
    this.#doc.observers.add(this);
  }
  takeRecords(): FakeRecord[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
  disconnect(): void {
    this.#doc?.observers.delete(this);
    this.queue = [];
  }
}

export class FDocument extends FNode {
  observers = new Set<FakeMutationObserver>();
  defaultView: FWindow;
  #listeners = new Map<string, Set<(e: unknown) => void>>();
  /** what elementFromPoint answers, when a test wants to say so */
  hit: ((x: number, y: number) => FElement | null) | null = null;
  /** REQ-547 — the document's adopted (constructed) stylesheets */
  adoptedStyleSheets: FCSSStyleSheet[] = [];
  constructor(href = "https://app.test/", w = 420, h = 800) {
    super(null as unknown as FDocument, 9, "#document");
    this.ownerDocument = this;
    this.defaultView = new FWindow(href, w, h);
  }
  get baseURI(): string {
    return this.defaultView.location.href;
  }
  get documentElement(): FElement | null {
    return (this.childNodes.find((c) => c.nodeType === 1) as FElement) ??
      null;
  }
  get scrollingElement(): FElement | null {
    return this.documentElement;
  }
  get head(): FElement | null {
    return find(this, (e) => e.localName === "head");
  }
  get body(): FElement | null {
    return find(this, (e) => e.localName === "body");
  }
  createElement(tag: string): FElement {
    return new FElement(this, tag.toLowerCase(), XHTML);
  }
  createElementNS(ns: string, tag: string): FElement {
    return new FElement(this, tag, ns);
  }
  createTextNode(data: string): FCharacterData {
    return new FCharacterData(this, 3, "#text", data);
  }
  createComment(data: string): FCharacterData {
    return new FCharacterData(this, 8, "#comment", data);
  }
  record(r: FakeRecord): void {
    if (!r.target.isConnected) return;
    for (const o of this.observers) o.queue.push(r);
  }
  addEventListener(t: string, fn: (e: unknown) => void): void {
    if (!this.#listeners.has(t)) this.#listeners.set(t, new Set());
    this.#listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: (e: unknown) => void): void {
    this.#listeners.get(t)?.delete(fn);
  }
  /** an event at `target`, as a capturing document listener sees it (REQ-638: with any extra
   *  fields a listener reads, a key's `key` and `altKey`) */
  fire(t: string, target: unknown, extra: Record<string, unknown> = {}): void {
    for (const fn of this.#listeners.get(t) ?? []) {
      fn({ ...extra, type: t, target });
    }
  }
  listening(t: string): number {
    return this.#listeners.get(t)?.size ?? 0;
  }
  elementFromPoint(x: number, y: number): FElement | null {
    if (this.hit) return this.hit(x, y);
    let best: FElement | null = null;
    walk(this, (e) => {
      const r = e.rect;
      if (
        x >= r.left && x < r.left + r.width && y >= r.top &&
        y < r.top + r.height
      ) best = e;
    });
    return best;
  }
}

/** every element under `root`, in document order */
export function walk(root: FNode, fn: (e: FElement) => void): void {
  for (const c of root.childNodes) {
    if (c.nodeType === 1) {
      fn(c as FElement);
      walk(c, fn);
    }
  }
}

export function find(
  root: FNode,
  pred: (e: FElement) => boolean,
): FElement | null {
  let hit: FElement | null = null;
  walk(root, (e) => {
    if (!hit && pred(e)) hit = e;
  });
  return hit;
}

export function findAll(
  root: FNode,
  pred: (e: FElement) => boolean,
): FElement[] {
  const out: FElement[] = [];
  walk(root, (e) => {
    if (pred(e)) out.push(e);
  });
  return out;
}

type Kid = FNode | string | null | false | undefined;

/** h("div", { class: "x" }, "text", h("span", {}, "y")) — an element with attributes and children */
export function h(
  doc: FDocument,
  tag: string,
  attrs: Record<string, string> = {},
  ...kids: Kid[]
): FElement {
  const svg = tag.startsWith("svg:");
  const el = svg
    ? doc.createElementNS(SVG, tag.slice(4))
    : doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) {
    if (k === null || k === false || k === undefined) continue;
    el.appendChild(typeof k === "string" ? doc.createTextNode(k) : k);
  }
  return el;
}

/** a document already holding `html` (built by the caller with `h`) */
export function docWith(
  build: (doc: FDocument) => FElement,
  href = "https://app.test/assistant?x=1",
  w = 420,
  h = 800,
): FDocument {
  const doc = new FDocument(href, w, h);
  doc.appendChild(build(doc));
  return doc;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A canonical text of a subtree: tags (SVG ones marked), attributes sorted, text, and the state a
 * screen shows that is not an attribute — an input's value and checked state, scroll offsets, a
 * painted canvas. Comments and the like are left out. Two DOMs that show the same thing read the
 * same.
 */
export function canon(n: FNode): string {
  if (n.nodeType === 3) return esc((n as FCharacterData).data);
  if (n.nodeType === 9) return n.childNodes.map(canon).join("");
  if (n.nodeType !== 1) return "";
  const e = n as FElement;
  const tag = (e.namespaceURI === SVG ? "svg:" : "") + e.localName;
  const attrs = e.attributes
    .map((a) => `${a.name}="${esc(a.value).replace(/"/g, "&quot;")}"`)
    .sort();
  if (FORM.has(e.localName)) {
    attrs.push(`:value="${esc(e.value)}"`);
    if (e.type === "checkbox" || e.type === "radio") {
      attrs.push(`:checked=${e.checked}`);
    }
  }
  if (e.scrollTop || e.scrollLeft) {
    attrs.push(`:scroll=${e.scrollLeft},${e.scrollTop}`);
  }
  if (e.painted) attrs.push(`:painted="${e.painted}"`);
  return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${
    e.childNodes.map(canon).join("")
  }</${tag}>`;
}
