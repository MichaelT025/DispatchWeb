import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProviderBrandIcon } from "../../web/src/components/ProviderBrandIcon";
import codexIcon from "../../web/src/assets/providers/openai-codex.svg";
import goIcon from "../../web/src/assets/providers/opencode-go.svg";
import commandIcon from "../../web/src/assets/providers/command-code.svg";
import neutralIcon from "../../web/src/assets/providers/neutral.svg";

describe("subscription provider marks", () => {
	it.each(["openai-codex", "opencode-go", "command-code"])(
		"bundles %s decoratively without network dependencies",
		(providerId) => {
			const markup = renderToStaticMarkup(createElement(ProviderBrandIcon, { providerId, className: "brand-test" }));
			const expected = new Map([
				["openai-codex", codexIcon],
				["opencode-go", goIcon],
				["command-code", commandIcon],
			]).get(providerId);
			expect(ProviderBrandIcon({ providerId }).props.src).toBe(expected);
			expect(markup).not.toMatch(/src="https?:/);
			expect(markup).toContain('alt=""');
			expect(markup).toContain('aria-hidden="true"');
			expect(markup).toContain('class="brand-test"');
			const svg = readFileSync(new URL(`../../web/src/assets/providers/${providerId}.svg`, import.meta.url), "utf8");
			expect(svg).not.toMatch(
				/<(?:script|image|foreignObject)\b|(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)|onload\s*=/i,
			);
		},
	);
	it("uses a neutral fallback for unknown IDs", () => {
		for (const providerId of ["unknown-provider", "__proto__"]) {
			expect(ProviderBrandIcon({ providerId }).props.src).toBe(neutralIcon);
		}
	});
});
