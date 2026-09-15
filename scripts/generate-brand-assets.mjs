/**
 * Reproducible Dispatch brand-asset generator.
 *
 * Canonical source: assets/dispatch.svg (user-supplied vector, byte-preserved).
 * Path geometry is copied exactly — only foreground fills are remapped.
 *
 * Outputs (all overwritten deterministically):
 *   web/src/assets/dispatch-mark.svg             runtime mark (currentColor ink, red core, crop 180 180 735 735)
 *   web/public/favicon.svg                       theme-aware mark (.ink adaptive #17171a/#f5f5f6, red core)
 *   web/public/icons/icon-{192,512,1024}.png       normal PWA icons (dark opaque bg, 84% artwork)
 *   web/public/icons/maskable-{192,512,1024}.png   maskable PWA icons (dark opaque bg, 58% artwork)
 *   web/public/icon.ico                            ICO frames 16/24/32/48/64/128 (+ PNG 256)
 *
 * Rendering: installed playwright-core + tests/lib/chrome.mjs (no new deps, no network).
 * PNG encoding: headless-Chromium canvas. ICO packing: hand-rolled directory
 * (32-bit BMP DIB frames, PNG-compressed 256px frame) — no dependencies.
 *
 * Usage: node scripts/generate-brand-assets.mjs   (run from the repo root)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "../tests/lib/chrome.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = join(ROOT, "web", "public", "icons");
const MARK_SVG_PATH = join(ROOT, "web", "src", "assets", "dispatch-mark.svg");
const FAVICON_SVG_PATH = join(ROOT, "web", "public", "favicon.svg");

/** Opaque icon background (dark, contrasts the light mark). */
const BG = "#131316";
/** Light mark ink for dark-background icons. */
const INK = "#f5f5f6";
/** Fixed red core. */
const RED = "#fc0b12";

/** Normal icons: artwork box 84% of canvas, centered. Maskable: 58% (safe-circle fit). */
const NORMAL_BOX = 0.84;
const MASKABLE_BOX = 0.58;
/** Square mark crop in dispatch.svg coordinates (geometry center 547.5,547.5). */
const MARK_VIEWBOX = "180 180 735 735";

const ICON_SIZES = [192, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function loadMarkPaths() {
	const src = readFileSync(join(ROOT, "assets", "dispatch.svg"), "utf8");
	const ds = [...src.matchAll(/<path\s+d="([^"]+)"\s*fill="([^"]+)"/g)];
	if (ds.length !== 3) throw new Error(`expected 3 paths in assets/dispatch.svg, found ${ds.length}`);
	const byFill = Object.fromEntries(ds.map((m) => [m[2], m[1]]));
	const dark = byFill["#070707"];
	const detail = byFill["#252524"];
	const core = byFill["#fc0b12"];
	if (!dark || !detail || !core)
		throw new Error("assets/dispatch.svg missing expected fills (#070707/#252524/#fc0b12)");
	return { dark, detail, core };
}

function markInner(ink) {
	const { dark, detail, core } = loadMarkPaths();
	const p = (d, fill) =>
		`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${fill}" stroke-width="0.25" stroke-linejoin="round"/>`;
	return `${p(dark, ink)}\n${p(core, RED)}\n${p(detail, ink)}`;
}

/** Full icon SVG: opaque dark canvas + centered mark at `box` fraction. */
function iconSvg(size, box) {
	const side = box * size;
	const off = (size - side) / 2;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
		`<rect width="${size}" height="${size}" fill="${BG}"/>` +
		`<svg x="${off}" y="${off}" width="${side}" height="${side}" viewBox="${MARK_VIEWBOX}">` +
		`${markInner(INK)}` +
		`</svg></svg>`
	);
}

/** Runtime mark: currentColor ink + fixed red core, cropped to the square mark. */
function markSvgText({ dark, detail, core }) {
	const p = (d, fill) =>
		`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${fill}" stroke-width="0.25" stroke-linejoin="round"/>`;
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">\n` +
		`<!-- Dispatch mark derived from assets/dispatch.svg: path geometry copied exactly; dark/detail foreground uses currentColor, red core keeps #fc0b12. Canvas cropped to the square mark (180,180,735,735). -->\n` +
		`${p(dark, "currentColor")}\n` +
		`${p(core, RED)}\n` +
		`${p(detail, "currentColor")}\n` +
		`</svg>\n`
	);
}

/** Theme-aware favicon: .ink adapts (#17171a light / #f5f5f6 dark), red core fixed. */
function faviconSvgText({ dark, detail, core }) {
	const p = (d, cls) =>
		`<path d="${d}" class="${cls}" fill-rule="evenodd" stroke-width="0.25" stroke-linejoin="round"/>`;
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">\n` +
		`<style>\n` +
		`  .ink { fill: #17171a; stroke: #17171a; }\n` +
		`  .core { fill: #fc0b12; stroke: #fc0b12; }\n` +
		`  @media (prefers-color-scheme: dark) {\n` +
		`    .ink { fill: #f5f5f6; stroke: #f5f5f6; }\n` +
		`  }\n` +
		`</style>\n` +
		`${p(dark, "ink")}\n` +
		`${p(core, "core")}\n` +
		`${p(detail, "ink")}\n` +
		`</svg>\n`
	);
}

function writeVectorMarks() {
	const paths = loadMarkPaths();
	mkdirSync(dirname(MARK_SVG_PATH), { recursive: true });
	writeFileSync(MARK_SVG_PATH, markSvgText(paths));
	console.log("wrote web/src/assets/dispatch-mark.svg");
	writeFileSync(FAVICON_SVG_PATH, faviconSvgText(paths));
	console.log("wrote web/public/favicon.svg");
}

/** Minimal PNG decoder (8-bit non-interlaced RGBA/RGB) via node:zlib. */
function decodePng(png) {
	if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error("bad PNG signature");
	let pos = 8;
	let width;
	let height;
	let bitDepth;
	let colorType;
	const idat = [];
	while (pos < png.length) {
		const len = png.readUInt32BE(pos);
		const type = png.toString("ascii", pos + 4, pos + 8);
		const data = png.subarray(pos + 8, pos + 8 + len);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			if (bitDepth !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0)
				throw new Error(`unsupported PNG format (depth ${bitDepth}, compression/filter/interlace)`);
			if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG color type ${colorType}`);
		} else if (type === "IDAT") {
			idat.push(data);
		} else if (type === "IEND") {
			break;
		}
		pos += 12 + len;
	}
	const channels = colorType === 6 ? 4 : 3;
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(idat));
	const rgba = Buffer.alloc(width * height * 4);
	let p = 0;
	let prevRow = Buffer.alloc(stride, 0);
	for (let y = 0; y < height; y++) {
		const filter = raw[p++];
		const row = Buffer.alloc(stride);
		for (let i = 0; i < stride; i++) {
			const v = raw[p++];
			const a = i >= channels ? row[i - channels] : 0;
			const b = prevRow[i];
			const c = i >= channels ? prevRow[i - channels] : 0;
			let recon;
			switch (filter) {
				case 0:
					recon = v;
					break;
				case 1:
					recon = (v + a) & 0xff;
					break;
				case 2:
					recon = (v + b) & 0xff;
					break;
				case 3:
					recon = (v + ((a + b) >> 1)) & 0xff;
					break;
				case 4: {
					const pa = Math.abs(b - c);
					const pb = Math.abs(a - c);
					const pc = Math.abs(a + b - 2 * c);
					recon = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
					break;
				}
				default:
					throw new Error(`unknown PNG filter ${filter}`);
			}
			row[i] = recon;
		}
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (channels === 4) {
				rgba[o] = row[x * 4];
				rgba[o + 1] = row[x * 4 + 1];
				rgba[o + 2] = row[x * 4 + 2];
				rgba[o + 3] = row[x * 4 + 3];
			} else {
				rgba[o] = row[x * 3];
				rgba[o + 1] = row[x * 3 + 1];
				rgba[o + 2] = row[x * 3 + 2];
				rgba[o + 3] = 255;
			}
		}
		prevRow = row;
	}
	return { width, height, rgba };
}

/** Pack RGBA pixels as a 32-bit BMP DIB frame (bottom-up BGRA + zero AND mask). */
function dibFrame(rgba, w, h) {
	const header = Buffer.alloc(40);
	header.writeUInt32LE(40, 0);
	header.writeInt32LE(w, 4);
	header.writeInt32LE(h * 2, 8); // height x2 (XOR + AND masks)
	header.writeUInt16LE(1, 12);
	header.writeUInt16LE(32, 14);
	header.writeUInt32LE(0, 16);
	header.writeUInt32LE(w * h * 4, 20);
	const pixels = Buffer.alloc(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const s = (y * w + x) * 4;
			const d = ((h - 1 - y) * w + x) * 4;
			pixels[d] = rgba[s + 2];
			pixels[d + 1] = rgba[s + 1];
			pixels[d + 2] = rgba[s];
			pixels[d + 3] = rgba[s + 3];
		}
	}
	const maskRow = ((w + 31) >> 5) * 4;
	const mask = Buffer.alloc(maskRow * h, 0); // fully opaque
	return Buffer.concat([header, pixels, mask]);
}

function writeIco(frames, outPath) {
	// frames: [{ size, data: Buffer(png or dib), png: boolean }]
	const count = frames.length;
	const header = Buffer.alloc(6 + 16 * count);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(count, 4);
	let offset = 6 + 16 * count;
	frames.forEach((f, i) => {
		const o = 6 + 16 * i;
		header[o] = f.size >= 256 ? 0 : f.size;
		header[o + 1] = f.size >= 256 ? 0 : f.size;
		header[o + 2] = 0;
		header[o + 3] = 0;
		header.writeUInt16LE(1, o + 4);
		header.writeUInt16LE(32, o + 6);
		header.writeUInt32LE(f.data.length, o + 8);
		header.writeUInt32LE(offset, o + 12);
		offset += f.data.length;
	});
	writeFileSync(outPath, Buffer.concat([header, ...frames.map((f) => f.data)]));
}

async function renderPng(page, size, box) {
	// Await SVG decode and rasterize to an explicit canvas, avoiding viewport
	// screenshot/compositor timing differences at large icon sizes.
	const png = await page.evaluate(
		async ({ svg, size }) => {
			const image = new Image();
			image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("2D canvas unavailable");
			context.drawImage(image, 0, 0, size, size);
			return canvas.toDataURL("image/png").split(",")[1];
		},
		{ svg: iconSvg(size, box), size },
	);
	const buf = Buffer.from(png, "base64");
	const { width, height } = decodePng(buf);
	if (width !== size || height !== size) throw new Error(`rendered ${width}x${height}, expected ${size}x${size}`);
	return buf;
}

async function main() {
	if (!CHROME_PATH) throw new Error("no Chrome/Chromium found (set PI_WEB_CHROME)");
	mkdirSync(ICON_DIR, { recursive: true });
	writeVectorMarks();
	const browser = await chromium.launch({ executablePath: CHROME_PATH });
	try {
		const page = await browser.newPage();
		for (const size of ICON_SIZES) {
			const normal = await renderPng(page, size, NORMAL_BOX);
			writeFileSync(join(ICON_DIR, `icon-${size}.png`), normal);
			console.log(`wrote icons/icon-${size}.png (${normal.length} bytes)`);
			const maskable = await renderPng(page, size, MASKABLE_BOX);
			writeFileSync(join(ICON_DIR, `maskable-${size}.png`), maskable);
			console.log(`wrote icons/maskable-${size}.png (${maskable.length} bytes)`);
		}
		const frames = [];
		for (const size of ICO_SIZES) {
			const png = await renderPng(page, size, NORMAL_BOX);
			if (size >= 256) {
				frames.push({ size, data: png, png: true });
			} else {
				const { rgba } = decodePng(png);
				frames.push({ size, data: dibFrame(rgba, size, size), png: false });
			}
			console.log(`ico frame ${size}x${size} ready`);
		}
		writeIco(frames, join(ROOT, "web", "public", "icon.ico"));
		console.log("wrote web/public/icon.ico");
	} finally {
		await browser.close();
	}
}

await main();
