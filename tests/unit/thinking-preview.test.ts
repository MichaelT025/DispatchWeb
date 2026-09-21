import { describe, expect, it } from "vitest";
import { thinkingPreviewLine } from "../../web/src/thinking-preview.js";

describe("thinkingPreviewLine", () => {
	it("skips a bold opening header and previews the first reasoning line", () => {
		expect(thinkingPreviewLine("**Checking provider auth lookup**\n\nThe lookup reads auth.json first.\nmore")).toBe(
			"The lookup reads auth.json first.",
		);
		expect(thinkingPreviewLine("## Plan\n__Step one__:\nRead the config.")).toBe("Read the config.");
	});
	it("falls back to the header text without markers when that is all there is", () => {
		expect(thinkingPreviewLine("**Checking provider auth lookup**")).toBe("Checking provider auth lookup");
		expect(thinkingPreviewLine("### Title only\n")).toBe("Title only");
	});
	it("keeps inline emphasis inside a real sentence and clips long lines", () => {
		expect(thinkingPreviewLine("I should **not** touch that file.")).toBe("I should **not** touch that file.");
		expect(thinkingPreviewLine("x".repeat(100))).toBe(`${"x".repeat(80)}…`);
		expect(thinkingPreviewLine("")).toBe("");
	});
});
