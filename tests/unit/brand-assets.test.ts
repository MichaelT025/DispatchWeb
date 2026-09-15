import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const ROOT = join(__dirname, "..", "..");
const RED = "#fc0b12";

function read(name: string): string {
	return readFileSync(join(ROOT, name), "utf8");
}

function sha256(name: string): string {
	return createHash("sha256")
		.update(readFileSync(join(ROOT, name)))
		.digest("hex");
}

/** Test file paths strip the manifest `?v=` cache query. */
function stripQuery(src: string): string {
	return src.split("?")[0].replace(/^\.\//, "");
}

function pathDs(svg: string): string[] {
	return [...svg.matchAll(/<path\s+d="([^"]+)"/g)].map((m) => m[1]);
}

/** Minimal PNG reader: dimensions + RGBA pixels (8-bit, non-interlaced). */
function decodePng(png: Buffer): { width: number; height: number; rgba: Buffer } {
	if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("bad PNG signature");
	let pos = 8;
	let width = 0;
	let height = 0;
	let colorType = 0;
	const idat: Buffer[] = [];
	while (pos < png.length) {
		const len = png.readUInt32BE(pos);
		const type = png.toString("ascii", pos + 4, pos + 8);
		const data = png.subarray(pos + 8, pos + 8 + len);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			if (data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0)
				throw new Error("unsupported PNG format");
			colorType = data[9];
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
			switch (filter) {
				case 0:
					row[i] = v;
					break;
				case 1:
					row[i] = (v + a) & 0xff;
					break;
				case 2:
					row[i] = (v + b) & 0xff;
					break;
				case 3:
					row[i] = (v + ((a + b) >> 1)) & 0xff;
					break;
				case 4: {
					const pa = Math.abs(b - c);
					const pb = Math.abs(a - c);
					const pc = Math.abs(a + b - 2 * c);
					row[i] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
					break;
				}
				default:
					throw new Error(`unknown PNG filter ${filter}`);
			}
		}
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			rgba[o] = row[x * channels];
			rgba[o + 1] = row[x * channels + 1];
			rgba[o + 2] = row[x * channels + 2];
			rgba[o + 3] = channels === 4 ? row[x * 4 + 3] : 255;
		}
		prevRow = row;
	}
	return { width, height, rgba };
}

describe("brand assets", () => {
	it("dispatch-mark.svg preserves supplied geometry, currentColor ink, red core", () => {
		const mark = read("web/src/assets/dispatch-mark.svg");
		const source = read("assets/dispatch.svg");
		expect(mark).toContain('viewBox="180 180 735 735"');
		// Geometry copied exactly (no redraw): all 3 source path `d` strings present verbatim.
		const sourceDs = pathDs(source);
		expect(sourceDs).toHaveLength(3);
		for (const d of sourceDs) expect(mark).toContain(d);
		// Dark/detail foreground follows theme; red core keeps its hue.
		expect(mark).toContain("currentColor");
		expect(mark).not.toContain("#070707");
		expect(mark).not.toContain("#252524");
		expect(mark.toLowerCase()).toContain(RED);
	});

	it("favicon.svg is theme-aware via prefers-color-scheme with red core", () => {
		const favicon = read("web/public/favicon.svg");
		expect(favicon).toContain('viewBox="180 180 735 735"');
		expect(favicon).toContain("prefers-color-scheme");
		expect(favicon).toContain("dark");
		expect(favicon.toLowerCase()).toContain(RED);
		// Same preserved geometry as the runtime mark.
		for (const d of pathDs(read("assets/dispatch.svg"))) expect(favicon).toContain(d);
	});

	it("supplied logo bytes are preserved byte-for-byte; obsolete PiAstra assets are gone", () => {
		expect(existsSync(join(ROOT, "assets", "dispatch-dark.png"))).toBe(true);
		expect(existsSync(join(ROOT, "assets", "dispatch-light.png"))).toBe(true);
		expect(existsSync(join(ROOT, "assets", "dispatch.svg"))).toBe(true);
		// Original user-supplied bytes: the generator reads (never rewrites) these.
		expect(sha256("assets/dispatch-dark.png")).toBe("6fa28e7f5b63bf609549092eeae79e47e7f42edd7b31b6f39ae5d473c617a559");
		expect(sha256("assets/dispatch-light.png")).toBe(
			"576db9f0c98f8152c3d4272b5ba2000910fc623cebeed17746a2b68919a58401",
		);
		expect(sha256("assets/dispatch.svg")).toBe("c9fac303a8f21a69c6d05c2574b11ea5a1497e1d06a4baf04e876cf626ab253a");
		expect(existsSync(join(ROOT, "assets", "PiAstra.png"))).toBe(false);
		expect(existsSync(join(ROOT, "assets", "PiAstra.svg"))).toBe(false);
	});

	it("refreshes browser icon URLs and the disposable static cache", () => {
		const html = read("web/index.html");
		expect(html).toContain("favicon.svg?v=dispatch-logo-2");
		expect(html).toContain("icons/icon-192.png?v=dispatch-logo-2");
		expect(read("web/public/sw.js")).toContain('const STATIC_CACHE = "pi-web-ui-static-dispatch-logo-2"');
	});

	it("manifest icons exist at the referenced paths with matching sizes", () => {
		const manifest = JSON.parse(read("web/public/manifest.webmanifest")) as {
			icons: { src: string; sizes: string; type: string }[];
		};
		expect(manifest.icons.length).toBeGreaterThanOrEqual(6);
		for (const icon of manifest.icons) {
			expect(icon.src).toContain("?v=dispatch-logo-2");
			const file = stripQuery(icon.src);
			const png = readFileSync(join(ROOT, "web", "public", file));
			const { width, height } = decodePng(png);
			const [w, h] = icon.sizes.split("x").map(Number);
			expect(`${width}x${height}`).toBe(`${w}x${h}`);
			expect(icon.type).toBe("image/png");
		}
	});

	it("normal icons carry the light/red mark on a dark opaque background", () => {
		for (const size of [192, 512, 1024]) {
			const { width, height, rgba } = decodePng(readFileSync(join(ROOT, `web/public/icons/icon-${size}.png`)));
			expect(width).toBe(size);
			expect(height).toBe(size);
			let red = 0;
			let opaque = 0;
			for (let i = 0; i < width * height; i++) {
				if (rgba[i * 4 + 3] === 255) opaque++;
				if (rgba[i * 4] === 0xfc && rgba[i * 4 + 1] === 0x0b && rgba[i * 4 + 2] === 0x12) red++;
			}
			expect(opaque).toBe(width * height);
			expect(red).toBeGreaterThan(0);
		}
	});

	it("maskable glyph fits inside the centered safe circle (r = 40% canvas)", () => {
		for (const size of [192, 512, 1024]) {
			const { width, height, rgba } = decodePng(readFileSync(join(ROOT, `web/public/icons/maskable-${size}.png`)));
			const cx = width / 2;
			const cy = height / 2;
			const r = 0.4 * width;
			let checked = 0;
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const i = (y * width + x) * 4;
					const [rr, gg, bb] = [rgba[i], rgba[i + 1], rgba[i + 2]];
					if (rr === 0x13 && gg === 0x13 && bb === 0x16) continue; // background
					checked++;
					expect(Math.hypot(x + 0.5 - cx, y + 0.5 - cy)).toBeLessThanOrEqual(r + 1);
				}
			}
			expect(checked).toBeGreaterThan(0);
		}
	});

	it("icon.ico packs 16/24/32/48/64/128/256 frames with valid offsets and image data", () => {
		const ico = readFileSync(join(ROOT, "web/public/icon.ico"));
		expect(ico.readUInt16LE(0)).toBe(0);
		expect(ico.readUInt16LE(2)).toBe(1);
		const count = ico.readUInt16LE(4);
		expect(count).toBe(7);
		const headerEnd = 6 + 16 * count;
		expect(ico.length).toBeGreaterThan(headerEnd);
		const ranges: { offset: number; length: number; size: number }[] = [];
		const sizes = new Set<number>();
		for (let i = 0; i < count; i++) {
			const o = 6 + 16 * i;
			const size = ico[o] === 0 ? 256 : ico[o];
			expect(ico[o + 1] === 0 ? 256 : ico[o + 1]).toBe(size);
			sizes.add(size);
			expect(ico[o + 2]).toBe(0); // reserved
			expect(ico.readUInt16LE(o + 4)).toBe(1); // color planes
			expect(ico.readUInt16LE(o + 6)).toBe(32); // bits per pixel
			const length = ico.readUInt32LE(o + 8);
			const offset = ico.readUInt32LE(o + 12);
			expect(length).toBeGreaterThan(0);
			expect(offset).toBeGreaterThanOrEqual(headerEnd);
			expect(offset + length).toBeLessThanOrEqual(ico.length);
			ranges.push({ offset, length, size });
		}
		for (const s of [16, 24, 32, 48, 64, 128, 256]) expect(sizes.has(s)).toBe(true);
		// Frames must not overlap and must exactly tile the trailing payload.
		const sorted = [...ranges].sort((a, b) => a.offset - b.offset);
		expect(sorted[0].offset).toBe(headerEnd);
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i].offset).toBe(sorted[i - 1].offset + sorted[i - 1].length);
		}
		expect(sorted[sorted.length - 1].offset + sorted[sorted.length - 1].length).toBe(ico.length);
		for (const { offset, length, size } of ranges) {
			const frame = ico.subarray(offset, offset + length);
			if (size >= 256) {
				// PNG-compressed frame: signature + IHDR dimensions.
				expect(frame.readUInt32BE(0)).toBe(0x89504e47);
				expect(frame.readUInt32BE(4)).toBe(0x0d0a1a0a);
				expect(frame.toString("ascii", 12, 16)).toBe("IHDR");
				expect(frame.readUInt32BE(16)).toBe(256);
				expect(frame.readUInt32BE(20)).toBe(256);
			} else {
				// 32-bit BMP DIB frame: header geometry + BGRA pixels + zero AND mask.
				expect(frame.readUInt32LE(0)).toBe(40);
				expect(frame.readInt32LE(4)).toBe(size);
				expect(frame.readInt32LE(8)).toBe(size * 2);
				expect(frame.readUInt16LE(12)).toBe(1);
				expect(frame.readUInt16LE(14)).toBe(32);
				expect(frame.readUInt32LE(16)).toBe(0); // BI_RGB
				const maskRow = ((size + 31) >> 5) * 4;
				expect(length).toBe(40 + size * size * 4 + maskRow * size);
				expect(frame.readUInt32LE(20)).toBe(size * size * 4);
			}
		}
	});

	describe("linux desktop icon", () => {
		it("desktop-icon.svg is opaque with fixed paint (no currentColor / media queries)", () => {
			const svg = read("web/public/desktop-icon.svg");
			const lower = svg.toLowerCase();
			// Opaque dark canvas + fixed light ink + red core (same scheme as the PNG icons).
			expect(svg).toContain('<rect width="512" height="512" fill="#131316"/>');
			expect(lower).toContain("#f5f5f6");
			expect(lower).toContain(RED);
			expect(svg).not.toContain("currentColor");
			expect(svg).not.toContain("prefers-color-scheme");
			expect(svg).not.toContain('class="ink"');
			// No stale dark-source fills leak through the remap.
			expect(svg).not.toContain("#070707");
			expect(svg).not.toContain("#252524");
			// Same preserved Dispatch geometry as the runtime mark.
			for (const d of pathDs(read("assets/dispatch.svg"))) expect(svg).toContain(d);
		});

		it("desktop-icon.svg is byte-reproducible from assets/dispatch.svg", () => {
			const source = read("assets/dispatch.svg");
			const byFill = Object.fromEntries(
				[...source.matchAll(/<path\s+d="([^"]+)"\s*fill="([^"]+)"/g)].map((m) => [m[2], m[1]]),
			) as Record<string, string>;
			const paint = (d: string, fill: string) =>
				`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${fill}" stroke-width="0.25" stroke-linejoin="round"/>`;
			const inner = `${paint(byFill["#070707"], "#f5f5f6")}\n${paint(byFill["#fc0b12"], RED)}\n${paint(byFill["#252524"], "#f5f5f6")}`;
			const size = 512;
			const side = 0.84 * size;
			const off = (size - side) / 2;
			const expected =
				`<?xml version="1.0" encoding="UTF-8"?>\n` +
				`<!-- Dispatch desktop icon derived from assets/dispatch.svg: path geometry copied exactly; opaque background #131316, light foreground #f5f5f6, red core #fc0b12. Fixed opaque paint (no theme queries) for Linux .desktop shells. -->\n` +
				`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
				`<rect width="${size}" height="${size}" fill="#131316"/>` +
				`<svg x="${off}" y="${off}" width="${side}" height="${side}" viewBox="180 180 735 735">` +
				`${inner}</svg></svg>\n`;
			expect(read("web/public/desktop-icon.svg")).toBe(expected);
			// The generator owns this output deterministically.
			const generator = read("scripts/generate-brand-assets.mjs");
			expect(generator).toContain("desktop-icon.svg");
			expect(generator).toContain("desktopSvgText");
		});

		it("linux shortcut packages the dedicated icon at the stable installed path", () => {
			const cli = read("bin/pi-web-ui.mjs");
			// Package source is the dedicated opaque asset — never the adaptive favicon.
			expect(cli).toContain('web", "public", "desktop-icon.svg"');
			const shortcut = cli.slice(cli.indexOf("function installLinuxShortcut"));
			expect(shortcut).not.toContain("favicon");
			// Installed icon path stays stable for existing .desktop files.
			expect(cli).toContain('"pi-web-ui.svg"');
			expect(shortcut).toContain("copyFileSync(APP_SVG_PACKAGE, svgPath)");
			expect(shortcut).toContain("Icon=${shQuote(desktopIcon)}");
			// Legacy identifiers unchanged.
			expect(cli).toContain('"pi-web-ui.desktop"');
			expect(cli).toContain('"pi-web-ui.lnk"');
			expect(cli).toContain('"pi-web-ui.command"');
		});

		it("adaptive favicon stays browser-only and is not referenced by the desktop entry", () => {
			// Favicon remains theme-adaptive for browsers.
			expect(read("web/public/favicon.svg")).toContain("prefers-color-scheme");
			const cli = read("bin/pi-web-ui.mjs");
			const shortcut = cli.slice(cli.indexOf("function installLinuxShortcut"));
			expect(shortcut).not.toContain("favicon.svg");
			expect(shortcut).toContain("Icon=${shQuote(desktopIcon)}");
		});
	});
});
