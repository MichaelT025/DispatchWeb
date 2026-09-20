// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LanguageProvider } from "../../web/src/i18n.js";
import { WorkersPanel } from "../../web/src/components/WorkersPanel.js";
import type { ClientMessage, UiWorker } from "../../web/src/types.js";

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function worker(id: number, over: Partial<UiWorker> = {}): UiWorker {
	return {
		id,
		toolCallId: "call-1",
		role: "general",
		model: "provider/model",
		task: `Task ${id}`,
		status: "running",
		activity: "Thinking…",
		started: 1000,
		recent: [],
		text: "",
		hasTranscript: true,
		...over,
	};
}

function mount(workers: UiWorker[], selected: number | null = null) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const onSelect = vi.fn();
	const send = vi.fn((_message: ClientMessage) => true);
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(WorkersPanel, {
					workers,
					transcripts: new Map(),
					conversationId: undefined,
					selected,
					onSelect,
					send,
				}),
			),
		);
	});
	return { container, onSelect, send };
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("WorkersPanel list", () => {
	it("keeps rows to status, a short task, and elapsed time", () => {
		const { container } = mount([
			worker(1, {
				task: "Implement the compact worker list.\nImplementation details: do not expose this in the list.",
				activity: "raw error output must stay in the detail view",
			}),
			worker(2, {
				task: "Investigate the failed build. Implementation details: noisy context.",
				status: "failed",
				activity: "SECRET RAW ERROR",
				ended: 13_000,
			}),
		]);

		const rows = [...container.querySelectorAll<HTMLButtonElement>(".worker-row")];
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain("Implement the compact worker list.");
		expect(rows[0].textContent).not.toContain("Implementation details");
		expect(rows[0].textContent).not.toContain("general");
		expect(rows[0].textContent).not.toContain("provider/model");
		expect(rows[0].textContent).not.toContain("#1");
		expect(rows[0].textContent).not.toContain("raw error output");
		expect(rows[0].textContent).not.toContain("Running");
		expect(rows[0].querySelector(".worker-elapsed")?.textContent).toMatch(/\d+(?:s|m)/);
		expect(rows[0].querySelector(".worker-row-status")?.getAttribute("aria-label")).toBe("Running");

		expect(rows[1].textContent).toContain("Failed");
		expect(rows[1].textContent).not.toContain("SECRET RAW ERROR");
		expect(rows[1].textContent).not.toContain("provider/model");
		expect(rows[1].querySelector(".worker-row-status")?.getAttribute("aria-label")).toBe("Failed");
	});

	it("distinguishes every status with a unique glyph and tooltip", () => {
		const statuses: UiWorker["status"][] = ["starting", "running", "completed", "failed", "cancelled", "interrupted"];
		const { container } = mount(statuses.map((status, index) => worker(index + 1, { status })));
		const indicators = [...container.querySelectorAll<HTMLElement>(".worker-row-status")];
		expect(indicators).toHaveLength(statuses.length);
		const glyphs = indicators.map((indicator) => {
			expect(indicator.title).toBe(indicator.getAttribute("aria-label"));
			expect(indicator.title).not.toBe("");
			const icon = indicator.querySelector("svg");
			expect(icon?.getAttribute("aria-hidden")).toBe("true");
			return icon?.innerHTML;
		});
		expect(new Set(glyphs).size).toBe(statuses.length);
		expect(container.querySelector(".shimmer")).toBeNull();
	});

	it("selects a worker row", () => {
		const { container, onSelect } = mount([worker(7)]);
		act(() => (container.querySelector(".worker-row") as HTMLButtonElement).click());
		expect(onSelect).toHaveBeenCalledWith(7);
	});

	it("hides completed rows behind a closed native disclosure", () => {
		const { container } = mount([worker(1), worker(2, { status: "completed", ended: 13_000 })]);
		const completed = container.querySelector("details.workers-section") as HTMLDetailsElement;
		expect(completed).not.toBeNull();
		expect(completed.open).toBe(false);
		expect(completed.querySelector("summary")?.textContent).toContain("Done");
		expect(completed.querySelectorAll(".worker-row")).toHaveLength(1);

		act(() => (completed.querySelector("summary") as HTMLElement).click());
		expect(completed.open).toBe(true);
	});
});
