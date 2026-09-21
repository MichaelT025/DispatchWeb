// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LanguageProvider, t } from "../../web/src/i18n.js";
import { Message } from "../../web/src/components/Message.js";
import { CollapsedMessage } from "../../web/src/components/CollapsedMessage.js";
import { OPEN_WORKER_EVENT } from "../../web/src/components/ToolCallBlock.js";
import { workerResultPreview, workerResultsFromDetails } from "../../web/src/components/WorkerResultCard.js";
import { delegateLiveState } from "../../web/src/workers-store.js";
import type { UiMessage, UiWorker } from "../../web/src/types.js";

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A `dispatch-worker-result` message as the server serializes it: the
 *  model-facing text plus the extension's structured details. */
function resultMessage(over: Partial<UiMessage> = {}): UiMessage {
	return {
		id: "c-1",
		role: "custom",
		customType: "dispatch-worker-result",
		timestamp: 1,
		content: [
			{
				type: "text",
				text: "Worker results (2):\n\n#13 review · openai/x · completed · 37s\nNo remaining defects.\nTranscript: C:\\runs\\a.jsonl\n\n#12 fast · openai/y · FAILED · 0s\nUnavailable model.\nTranscript: (none)",
			},
		],
		details: {
			workers: [],
			results: [
				{
					id: 13,
					role: "review",
					status: "completed",
					ok: true,
					text: "No remaining **defects**.\n\n- runtime.ts:166 ok",
					elapsed: "37s",
				},
				{ id: 12, role: "fast", status: "failed", ok: false, text: "Unavailable model.", elapsed: "0s" },
			],
		},
		...over,
	} as UiMessage;
}

function mount(node: React.ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(createElement(LanguageProvider, null, node));
	});
	return container;
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("dispatch-worker-result message", () => {
	it("renders one collapsed '<role> #<id> finished' line per worker, not the text dump", () => {
		const container = mount(
			createElement(Message, {
				message: resultMessage(),
				toolResults: new Map(),
				liveOutputs: new Map(),
				toolStatuses: new Map(),
				streaming: false,
				isLast: false,
			}),
		);
		expect(container.querySelector(".msg-role")?.textContent).toBe("Workers");
		const rows = [...container.querySelectorAll<HTMLElement>(".workerresult")];
		expect(rows).toHaveLength(2);
		expect(rows[0].getAttribute("data-role")).toBe("review");
		expect(rows[0].querySelector(".worker-role svg")).not.toBeNull();
		expect(rows[0].querySelector(".workerresult-head")?.textContent).toBe("review#13finished37s");
		expect(rows[1].querySelector(".workerresult-head")?.textContent).toBe("fast#12failed0s");
		expect(rows[1].classList.contains("tone-err")).toBe(true);
		// collapsed: no result body, and nothing from the model-facing text
		expect(container.querySelector(".workerresult-body")).toBeNull();
		expect(container.textContent).not.toContain("Transcript:");
		expect(container.textContent).not.toContain("Worker results (2)");
	});

	it("expands a line to that worker's result as Markdown and opens its transcript", () => {
		const container = mount(
			createElement(Message, {
				message: resultMessage(),
				toolResults: new Map(),
				liveOutputs: new Map(),
				toolStatuses: new Map(),
				streaming: false,
				isLast: false,
			}),
		);
		const head = container.querySelector<HTMLElement>(".workerresult .workerresult-head")!;
		act(() => head.click());
		const body = container.querySelector(".workerresult-body");
		expect(body).not.toBeNull();
		expect(body?.querySelector("strong")?.textContent).toBe("defects");
		expect(body?.querySelector("li")?.textContent).toContain("runtime.ts:166");
		// only the clicked worker opened
		expect(container.querySelectorAll(".workerresult-body")).toHaveLength(1);

		const opened = vi.fn((e: Event) => (e as CustomEvent<number | null>).detail);
		window.addEventListener(OPEN_WORKER_EVENT, opened);
		act(() => container.querySelector<HTMLButtonElement>(".workerresult-open")!.click());
		expect(opened).toHaveBeenCalledTimes(1);
		expect(opened.mock.results[0].value).toBe(13);
		window.removeEventListener(OPEN_WORKER_EVENT, opened);
	});

	it("falls back to the generic custom renderer when details are missing", () => {
		const container = mount(
			createElement(Message, {
				message: resultMessage({ details: undefined }),
				toolResults: new Map(),
				liveOutputs: new Map(),
				toolStatuses: new Map(),
				streaming: false,
				isLast: false,
			}),
		);
		expect(container.querySelector(".workerresult")).toBeNull();
		expect(container.textContent).toContain("Worker results (2)");
		expect(workerResultsFromDetails({ results: [{ id: "x" }, null, { id: 4 }] }).map((r) => r.id)).toEqual([4]);
	});

	it("collapses to a 'Workers' row with a per-worker preview", () => {
		const container = mount(createElement(CollapsedMessage, { message: resultMessage(), onExpand: () => {} }));
		expect(container.querySelector(".msg-collapsed-role")?.textContent).toBe("Workers");
		expect(container.querySelector(".msg-collapsed-preview")?.textContent).toBe("review #13 finished, fast #12 failed");
		expect(workerResultPreview([{ id: 1, status: "cancelled" }], t)).toBe("worker #1 cancelled");
	});
});

describe("delegateLiveState", () => {
	const w = (id: number, status: UiWorker["status"], toolCallId = "call-1"): UiWorker =>
		({
			id,
			toolCallId,
			role: "fast",
			model: "m",
			task: "t",
			status,
			activity: "",
			started: 1,
			recent: [],
			text: "",
			hasTranscript: false,
		}) as UiWorker;

	it("is running while any worker of the call is attached, done after, unknown when none reported", () => {
		expect(delegateLiveState([], "call-1")).toBe("unknown");
		expect(delegateLiveState([w(1, "completed", "other")], "call-1")).toBe("unknown");
		expect(delegateLiveState([w(1, "completed"), w(2, "running")], "call-1")).toBe("running");
		expect(delegateLiveState([w(1, "completed"), w(2, "starting")], "call-1")).toBe("running");
		expect(delegateLiveState([w(1, "completed"), w(2, "failed")], "call-1")).toBe("done");
		expect(delegateLiveState([w(1, "running")], null)).toBe("unknown");
	});
});
