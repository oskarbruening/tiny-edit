// Builds build/icon.png (1024×1024, fully opaque) and build/icon.icns from logo.png: the logo's
// own dark brown edge to edge with the artwork centred. macOS (Tahoe and later) masks every
// legacy icon to its squircle itself; an icon with transparent margins is shrunk onto a grey
// tile instead, and the original logo is only ~90 % opaque, so grey showed through it too.
// The .icns is produced here with sips + iconutil because electron-builder's converter wrote
// noise into the 16 px size. Dependency-free (Node zlib + macOS tools).
// Run: node scripts/make-icon.mjs [logo.png] [build/icon.png]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIZE = 1024; // canvas, filled edge to edge
const ARTWORK = 1200; // logo scaled to this many px, centred (its braces then span ~70 % of the icon)
const SUPERSAMPLE = 4;
/** iconutil's required members: [name, pixel size]. */
const ICONSET = [
  ["icon_16x16", 16],
  ["icon_16x16@2x", 32],
  ["icon_32x32", 32],
  ["icon_32x32@2x", 64],
  ["icon_128x128", 128],
  ["icon_128x128@2x", 256],
  ["icon_256x256", 256],
  ["icon_256x256@2x", 512],
  ["icon_512x512", 512],
  ["icon_512x512@2x", 1024],
];

const [, , src = "logo.png", dest = "build/icon.png"] = process.argv;
const icns = join(dirname(dest), "icon.icns");

// ── PNG decode (8-bit RGBA, non-interlaced) ─────────────────────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error("expected 8-bit RGBA non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 255;
    }
    prev = out;
  }
  return { width, height, px };
}

// ── PNG encode ──────────────────────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng({ width, height, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Colour: the most common near-opaque colour in the logo is its background blob.
//    (The artwork has no fully opaque pixel at all, which is why the Dock's grey showed through.) ──
function dominantColour({ width, height, px }) {
  // Bin to 4 bits per channel (the blob is noisy), then average the winning bin.
  const bins = new Map();
  for (let i = 0; i < width * height * 4; i += 4) {
    if (px[i + 3] < 200) continue;
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += px[i];
    bin.g += px[i + 1];
    bin.b += px[i + 2];
    bins.set(key, bin);
  }
  let best = { n: 0, r: 0, g: 0, b: 0 };
  for (const bin of bins.values()) if (bin.n > best.n) best = bin;
  return [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round);
}

// ── Bilinear sample of the logo (premultiplied) at logo coordinates ─────────
function sampleLogo(logo, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const acc = [0, 0, 0, 0];
  for (const [ox, oy, w] of [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ]) {
    const x = x0 + ox;
    const y = y0 + oy;
    if (x < 0 || y < 0 || x >= logo.width || y >= logo.height || w === 0) continue;
    const i = (y * logo.width + x) * 4;
    const a = logo.px[i + 3] / 255;
    acc[0] += logo.px[i] * a * w;
    acc[1] += logo.px[i + 1] * a * w;
    acc[2] += logo.px[i + 2] * a * w;
    acc[3] += a * w;
  }
  return acc; // premultiplied rgb (0–255) + alpha (0–1)
}

function render(logo, bg) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const scale = logo.width / ARTWORK;
  const offset = (SIZE - ARTWORK) / 2;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      // Supersample the logo so the downscale does not alias.
      const art = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++)
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const s = sampleLogo(
            logo,
            (x + (sx + 0.5) / SUPERSAMPLE - offset) * scale - 0.5,
            (y + (sy + 0.5) / SUPERSAMPLE - offset) * scale - 0.5,
          );
          for (let k = 0; k < 4; k++) art[k] += s[k] / (SUPERSAMPLE * SUPERSAMPLE);
        }
      // Artwork (premultiplied) over the opaque background.
      const i = (y * SIZE + x) * 4;
      px[i] = Math.round(art[0] + bg[0] * (1 - art[3]));
      px[i + 1] = Math.round(art[1] + bg[1] * (1 - art[3]));
      px[i + 2] = Math.round(art[2] + bg[2] * (1 - art[3]));
      px[i + 3] = 255;
    }
  return { width: SIZE, height: SIZE, px };
}

/** build/icon.icns via sips (resize) + iconutil (pack); both ship with macOS. */
function writeIcns(png, out) {
  const dir = mkdtempSync(join(tmpdir(), "tiny-edit-icon-"));
  const iconset = join(dir, "icon.iconset");
  try {
    execFileSync("mkdir", [iconset]);
    for (const [name, size] of ICONSET)
      execFileSync("sips", ["-z", String(size), String(size), png, "--out", join(iconset, `${name}.png`)], {
        stdio: "ignore",
      });
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", out]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const logo = decodePng(readFileSync(src));
const bg = dominantColour(logo);
writeFileSync(dest, encodePng(render(logo, bg)));
writeIcns(dest, icns);
console.log(
  `${dest} + ${icns}: ${SIZE}×${SIZE} opaque, background #${bg
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}, artwork ${ARTWORK}px from ${src} (${logo.width}×${logo.height})`,
);
