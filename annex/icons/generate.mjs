// Renders every Annex app icon from the one mark below into annex/icons/out/. rebrand.sh copies
// those files over upstream's T3 icons, so this only needs to run when the design changes:
//
//   node annex/icons/generate.mjs
//
// The mark is the sidebar wordmark's A with its crossbar (the "annex" joining the two sides) in blue.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const sharp = NodeModule.createRequire(NodePath.join(here, "../../scripts/package.json"))("sharp");
const out = NodePath.join(here, "out");
NodeFS.mkdirSync(out, { recursive: true });

const A_PATH = "M0 57L21 0H39L60 57H45.5L41.6 45H18.4L14.5 57H0ZM22.2 33.5H37.8L30 9.5L22.2 33.5Z";
const CROSSBAR = "M18.4 45L22.2 33.5H37.8L41.6 45Z";
const INK = "#f2f5ff";
const ANNEX = "#7aa7ff";
// Radial background from the upper left. rebrand.sh uses the outer color for the Android splash.
const GLOW = [0x1d, 0x2a, 0x44];
const EDGE = [0x05, 0x07, 0x0d];

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`);
const raster = (body, size) => sharp(svg(body), { density: (72 * size) / 100 }).resize(size, size).png().toBuffer();

// The A (60x57 units) centered on a 100-unit canvas, `width` units wide.
const mark = (width, mono = false) => {
  const s = width / 60;
  return `<g transform="translate(${50 - 30 * s} ${50 - 28.5 * s}) scale(${s})"><path d="${A_PATH}" fill="${INK}"/><path d="${CROSSBAR}" fill="${mono ? INK : ANNEX}"/></g>`;
};

// The gradient painted per pixel with dithering: an SVG gradient this dark shows rings in 8-bit PNGs.
// Seeded, so re-running the script reproduces the same files byte for byte.
const background = (size) => {
  let seed = size;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.hypot(x / size - 0.3, y / size - 0.25));
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(GLOW[c] + (EDGE[c] - GLOW[c]) * t + random() - 0.5);
      data[i + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
};

// A background shape (100-unit rect) filled with the gradient, the mark on top, and optional layers below.
const icon = async (size, { markWidth, x = 0, size: box = 100, rx = 0, under = "" }) => {
  const shape = await raster(`<rect x="${x}" y="${x}" width="${box}" height="${box}" rx="${rx}"/>`, size);
  const filled = await sharp(await background(size)).composite([{ input: shape, blend: "dest-in" }]).png().toBuffer();
  const layers = [{ input: filled }, { input: await raster(mark(markWidth), size) }];
  if (under) layers.unshift({ input: await raster(under, size) });
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
};

// Full-bleed square (iOS, Linux, web touch icons): the platform applies its own mask.
const square = (size) => icon(size, { markWidth: 54 });
// Rounded tile for favicons and Windows, where nothing masks the icon.
const tile = (size, markWidth = 54, rx = 22.5) => icon(size, { markWidth, rx });
// macOS: an 824px tile on a 1024px canvas with a soft shadow, per Apple's icon grid.
const macos = (size) =>
  icon(size, {
    markWidth: 44,
    x: 9.77,
    size: 80.47,
    rx: 18.1,
    under: `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter><rect x="9.77" y="10.77" width="80.47" height="80.47" rx="18.1" fill-opacity=".35" filter="url(#s)"/>`,
  });

// ICO with PNG-encoded entries (Windows Vista and later read these directly).
const ico = async (render, sizes) => {
  const images = await Promise.all(sizes.map(render));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], entry);
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
};

const files = {
  "ios-1024.png": square(1024),
  "universal-1024.png": square(1024),
  "macos-1024.png": macos(1024),
  "windows.ico": ico((s) => tile(s), [16, 24, 32, 48, 64, 128, 256]),
  "web-favicon.ico": ico((s) => tile(s, 64, 20), [16, 32, 48]),
  "web-favicon-16x16.png": tile(16, 66, 18),
  "web-favicon-32x32.png": tile(32, 62, 20),
  "web-apple-touch-180.png": square(180),
  "web-icon-192x192.png": square(192),
  "web-icon-512x512.png": square(512),
  // Android adaptive layers: the A inside the 66dp safe zone of the 108dp canvas.
  "android-icon-foreground.png": raster(mark(40), 432),
  "android-icon-mark.png": raster(mark(40, true), 432),
  "android-splash-icon.png": raster(mark(30), 1152),
  "android-notification-icon.png": raster(mark(84, true), 96),
};

for (const [name, data] of Object.entries(files)) NodeFS.writeFileSync(NodePath.join(out, name), await data);
console.log(`wrote ${Object.keys(files).length} icons to ${out}`);
