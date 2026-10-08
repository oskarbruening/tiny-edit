/** Tiny inline-SVG helpers shared by the editor's hover buttons (copy, open-link). */

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** A 24×24 stroked icon at the button glyph size; children are `svgEl` paths/shapes. */
export function icon(...children: SVGElement[]): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    width: "13",
    height: "13",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  svg.append(...children);
  return svg;
}
