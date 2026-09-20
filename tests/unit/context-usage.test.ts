// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContextUsageIndicator } from "../../web/src/components/ContextUsageIndicator.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { UiState } from "../../web/src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ContextUsage = UiState["stats"]["contextUsage"];

let root: Root | null = null;

function mount(usage: ContextUsage | null | undefined) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => root!.render(createElement(LanguageProvider, null, createElement(ContextUsageIndicator, { usage }))));
	return container;
}

function usage(tokens: number | null, contextWindow = 1000, estimated = false): ContextUsage {
	return { tokens, contextWindow, percent: tokens === null ? null : (tokens / contextWindow) * 100, estimated };
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("ContextUsageIndicator", () => {
	it("renders zero, partial, full, and overflow progress safely", () => {
		const container = mount(usage(0, 10));
		const progress = () => container.querySelector<SVGCircleElement>(".context-usage-ring-progress")!;

		expect(progress().getAttribute("stroke-dashoffset")).toBe("100");
		expect(container.querySelector(".context-usage-tooltip")?.textContent).toContain("0 / 10 tokens (0%)");

		act(() =>
			root!.render(
				createElement(LanguageProvider, null, createElement(ContextUsageIndicator, { usage: usage(5, 10) })),
			),
		);
		expect(progress().getAttribute("stroke-dashoffset")).toBe("50");
		expect(container.querySelector(".context-usage-tooltip")?.textContent).toContain("5 / 10 tokens (50%)");

		act(() =>
			root!.render(
				createElement(LanguageProvider, null, createElement(ContextUsageIndicator, { usage: usage(10, 10) })),
			),
		);
		expect(progress().getAttribute("stroke-dashoffset")).toBe("0");

		act(() =>
			root!.render(
				createElement(LanguageProvider, null, createElement(ContextUsageIndicator, { usage: usage(15, 10) })),
			),
		);
		expect(progress().getAttribute("stroke-dashoffset")).toBe("0");
		expect(container.querySelector<HTMLElement>("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("100");
	});

	it("does not turn unknown or invalid capacity into zero progress", () => {
		const container = mount(usage(null, 1000));
		const progress = container.querySelector<SVGCircleElement>(".context-usage-ring-progress")!;
		const indicator = container.querySelector<HTMLElement>("[role=progressbar]")!;

		expect(indicator.getAttribute("aria-valuenow")).toBeNull();
		expect(indicator.getAttribute("aria-valuetext")).toBe("Context usage unavailable");
		expect(progress.getAttribute("stroke-dasharray")).toBe("18 82");
		expect(container.textContent).toContain("Context usage unavailable");

		act(() =>
			root!.render(
				createElement(LanguageProvider, null, createElement(ContextUsageIndicator, { usage: usage(-1, 0) })),
			),
		);
		expect(container.querySelector<HTMLElement>("[role=progressbar]")?.getAttribute("aria-valuenow")).toBeNull();
		expect(container.textContent).toContain("Context usage unavailable");
	});

	it("labels estimated counts and exposes a keyboard-focusable progress target", () => {
		const container = mount(usage(12345, 100000, true));
		const indicator = container.querySelector<HTMLElement>("[role=progressbar]")!;
		const tooltip = container.querySelector<HTMLElement>("[role=tooltip]")!;

		expect(indicator.tabIndex).toBe(0);
		expect(indicator.getAttribute("aria-label")).toBe("Estimated context usage: 12,345 / 100,000 tokens (12.3%)");
		expect(tooltip.textContent).toBe("Estimated context usage: 12,345 / 100,000 tokens (12.3%)");
	});

	it("updates the full tooltip and ring when usage changes", () => {
		const container = mount(usage(100, 1000));
		const progress = () => container.querySelector<SVGCircleElement>(".context-usage-ring-progress")!;
		expect(container.textContent).toContain("100 / 1,000 tokens (10%)");

		act(() =>
			root!.render(
				createElement(LanguageProvider, null, createElement(ContextUsageIndicator, { usage: usage(900, 1000) })),
			),
		);
		expect(progress().getAttribute("stroke-dashoffset")).toBe("10");
		expect(container.textContent).toContain("900 / 1,000 tokens (90%)");
	});
});
