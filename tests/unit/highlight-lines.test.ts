/**
 * highlight-lines.ts: per-line splitting of highlight.js output must keep the
 * span tree balanced on every line, and grammar selection must fall back to
 * plain (escaped) text rather than dropping content.
 */
import { describe, expect, it } from "vitest";
import { highlightFile, languageFor, splitHighlightedLines } from "../../web/src/highlight-lines.js";

describe("splitHighlightedLines", () => {
	it("closes open spans at a line break and reopens them on the next line", () => {
		const html = '<span class="hljs-comment">/* a\nb */</span> x';
		expect(splitHighlightedLines(html)).toEqual([
			'<span class="hljs-comment">/* a</span>',
			'<span class="hljs-comment">b */</span> x',
		]);
	});
	it("handles nested spans across several lines", () => {
		const html = '<span class="a">1<span class="b">2\n3\n4</span>5</span>';
		expect(splitHighlightedLines(html)).toEqual([
			'<span class="a">1<span class="b">2</span></span>',
			'<span class="a"><span class="b">3</span></span>',
			'<span class="a"><span class="b">4</span>5</span>',
		]);
	});
	it("plain text and empty lines survive untouched", () => {
		expect(splitHighlightedLines("a\n\nb")).toEqual(["a", "", "b"]);
		expect(splitHighlightedLines("")).toEqual([""]);
	});
});

describe("languageFor", () => {
	it("maps extensions and well-known bare names", () => {
		expect(languageFor("src/app.tsx")).toBe("typescript");
		expect(languageFor("C:\\x\\y.PY")).toBe("python");
		expect(languageFor("Dockerfile")).toBe("dockerfile");
		expect(languageFor("noext")).toBeUndefined();
	});
});

describe("highlightFile", () => {
	it("highlights a known grammar and escapes text", () => {
		const r = highlightFile('const a = "<b>";\nlet c = 1;', "x.ts");
		expect(r.language).toBe("typescript");
		expect(r.lines).toHaveLength(2);
		expect(r.lines[0]).toContain("hljs-keyword");
		expect(r.lines[0]).toContain("&lt;b&gt;");
		expect(r.lines[0]).not.toContain("<b>");
	});
	it("unknown extension → escaped plain lines, no grammar", () => {
		const r = highlightFile("a <b>\nc", "weird.zzz");
		expect(r.language).toBeUndefined();
		expect(r.lines).toEqual(["a &lt;b&gt;", "c"]);
	});
});
