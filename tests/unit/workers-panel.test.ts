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
	it("shows who did what: role, id, task, elapsed, and a detail line", () => {
		const { container } = mount([
			worker(1, {
				role: "fast",
				task: "Implement the compact worker list.\nImplementation details: do not expose this in the list.",
				activity: "read src/models.ts",
			}),
			worker(2, {
				role: "review",
				task: "Investigate the failed build. Implementation details: noisy context.",
				status: "failed",
				activity: "Unavailable model x/y; no fallback used.",
				ended: 13_000,
			}),
			worker(3, {
				role: "general",
				task: "Count the r's in raspberry.",
				status: "completed",
				activity: "Finished",
				text: "There are 3 r's.\n\nDetails below.",
				ended: 20_000,
			}),
		]);

		const rows = [...container.querySelectorAll<HTMLButtonElement>(".worker-row")];
		expect(rows).toHaveLength(3);
		// running
		expect(rows[0].getAttribute("data-role")).toBe("fast");
		expect(rows[0].querySelector(".worker-role")?.textContent).toBe("fast");
		expect(rows[0].querySelector(".worker-role svg")).not.toBeNull();
		expect(rows[0].querySelector(".worker-id")?.textContent).toBe("#1");
		expect(rows[0].querySelector(".worker-task")?.textContent).toBe("Implement the compact worker list.");
		expect(rows[0].textContent).not.toContain("Implementation details");
		expect(rows[0].textContent).not.toContain("provider/model");
		expect(rows[0].querySelector(".worker-elapsed")?.textContent).toMatch(/\d+(?:s|m)/);
		expect(rows[0].querySelector(".worker-row-status")?.getAttribute("aria-label")).toBe("Running");
		expect(rows[0].querySelector(".worker-row-detail.live")?.textContent).toBe("read src/models.ts");
		// Finished precedes Failed: #3 then #2
		// completed → first line of the result, not the activity
		expect(rows[1].querySelector(".worker-row-status")?.getAttribute("aria-label")).toBe("Done");
		expect(rows[1].querySelector(".worker-row-detail")?.textContent).toBe("There are 3 r's.");
		// failed → the reason
		expect(rows[2].querySelector(".worker-row-status")?.getAttribute("aria-label")).toBe("Failed");
		expect(rows[2].querySelector(".worker-row-detail")?.textContent).toBe("Unavailable model x/y; no fallback used.");
		expect(rows[2].querySelector(".worker-row-detail.live")).toBeNull();
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

	it("lists failures only in a collapsible Failed section below Finished and preserves selection", () => {
		const { container, onSelect } = mount([
			worker(1, { status: "completed" }),
			worker(2, { status: "failed", activity: "Provider request errored." }),
			worker(3, { status: "failed", activity: "Unavailable model; no fallback used." }),
		]);
		const headings = [...container.querySelectorAll(".workers-section-head")].map((el) => el.textContent);
		expect(headings).toEqual(["Running0", "Finished1", "Failed2"]);
		const failed = container.querySelector('[aria-labelledby="workers-failed-heading"]') as HTMLDetailsElement;
		const finished = container.querySelector('[aria-labelledby="workers-done-heading"]')!;
		expect(failed.open).toBe(true);
		expect([...failed.querySelectorAll(".worker-id")].map((el) => el.textContent)).toEqual(["#3", "#2"]);
		expect([...finished.querySelectorAll(".worker-id")].map((el) => el.textContent)).toEqual(["#1"]);
		expect(failed.textContent).toContain("Provider request errored.");
		act(() => failed.querySelector<HTMLButtonElement>(".worker-row")!.click());
		expect(onSelect).toHaveBeenCalledWith(3);
		act(() => failed.querySelector("summary")!.click());
		expect(failed.open).toBe(false);
	});

	it("keeps a failed worker's detail available without a Stop action", () => {
		const { container } = mount([worker(2, { status: "failed", activity: "Provider error" })], 2);
		expect(container.querySelector(".worker-detail-status")?.textContent).toContain("Failed");
		expect(container.querySelector(".worker-detail-foot")?.textContent).toBe("Provider error");
		expect(container.querySelector(".worker-cancel")).toBeNull();
	});

	it("lists finished rows under an open, collapsible Finished disclosure", () => {
		const { container } = mount([worker(1), worker(2, { status: "completed", ended: 13_000 })]);
		const sections = [...container.querySelectorAll<HTMLElement>(".workers-section")];
		expect(sections[0].querySelector(".workers-section-head")?.textContent).toContain("Running");
		const finished = container.querySelector("details.workers-section") as HTMLDetailsElement;
		expect(finished).not.toBeNull();
		expect(finished.open).toBe(true);
		expect(finished.querySelector("summary")?.textContent).toContain("Finished");
		expect(finished.querySelectorAll(".worker-row")).toHaveLength(1);

		act(() => (finished.querySelector("summary") as HTMLElement).click());
		expect(finished.open).toBe(false);
	});
});
