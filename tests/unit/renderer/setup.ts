// happy-dom lacks the layout APIs CodeMirror probes. Zero-size answers are enough for
// state/DOM behaviour tests; real geometry is covered by Playwright.
const rect = () => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});
const rects = () => Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= rects;
  Range.prototype.getBoundingClientRect ??= rect as unknown as () => DOMRect;
}
Element.prototype.getClientRects ??= rects;
document.elementFromPoint ??= () => null;
