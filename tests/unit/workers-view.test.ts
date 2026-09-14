import { describe, expect, it } from "vitest";
import type { UiMessage, UiWorker } from "../../server/protocol.js";
import {
	formatElapsed,
	splitWorkers,
	taskPreview,
	workerElapsedSec,
	workerStatusTone,
	workersForCall,
	workersFromDetails,
} from "../../web/src/workers.js";

function worker(id: number, over: Partial<UiWorker> = {}): UiWorker {
	return {
		id,
		toolCallId: "call-a",
		role: "general",
		model: "p/m",
		task: `t${id}`,
		status: "running",
		activity: "",
		started: 1000,
		recent: [],
		text: "",
		hasTranscript: true,
		...over,
	};
}

describe("splitWorkers", () => {
	it("active in start order, done newest first", () => {
		const { active, done } = splitWorkers([
			worker(3, { status: "completed" }),
			worker(1),
			worker(4, { status: "failed" }),
			worker(2, { status: "starting" }),
		]);
		expect(active.map((w) => w.id)).toEqual([1, 2]);
		expect(done.map((w) => w.id)).toEqual([4, 3]);
	});
});

describe("workersForCall", () => {
	const result: UiMessage = {
		id: "t-call-b",
		role: "toolResult",
		content: [],
		toolCallId: "call-b",
		details: {
			workers: [
				{ id: 7, role: "review", model: "m", task: "r", status: "running", started: 5, recent: ["x", 1], text: "y" },
				{ id: 6, role: "fast", status: "completed", started: 1, ended: 3 },
				{ role: "bad" },
			],
		},
	};

	it("prefers live workers linked by toolCallId", () => {
		const got = workersForCall(
			[worker(2, { toolCallId: "call-b" }), worker(1, { toolCallId: "call-b" }), worker(3)],
			"call-b",
			result,
		);
		expect(got.map((w) => w.id)).toEqual([1, 2]);
	});

	it("falls back to the saved details and marks unfinished ones interrupted", () => {
		const got = workersForCall([worker(3)], "call-b", result);
		expect(got.map((w) => w.id)).toEqual([6, 7]);
		expect(got[1]).toMatchObject({ status: "interrupted", recent: ["x"], text: "y", hasTranscript: false });
		expect(got[0]).toMatchObject({ status: "completed", ended: 3 });
		expect(workersFromDetails(undefined)).toEqual([]);
		expect(workersFromDetails({ workers: "no" })).toEqual([]);
	});
});

describe("elapsed / labels", () => {
	it("counts live workers up to now and freezes finished ones", () => {
		expect(workerElapsedSec({ started: 1000, status: "running" }, 61_500)).toBe(60);
		expect(workerElapsedSec({ started: 1000, ended: 4000, status: "completed" }, 999_000)).toBe(3);
		expect(workerElapsedSec({ started: 1000, status: "interrupted" }, 999_000)).toBeNull();
		expect(workerElapsedSec({ started: 0, status: "running" })).toBeNull();
		expect(formatElapsed(null)).toBe("");
	});
	it("formats seconds, minutes and hours", () => {
		expect(formatElapsed(42)).toBe("42s");
		expect(formatElapsed(185)).toBe("3m 05s");
		expect(formatElapsed(3720)).toBe("1h 02m");
	});
	it("maps status to a tone", () => {
		expect(workerStatusTone("running")).toBe("run");
		expect(workerStatusTone("completed")).toBe("ok");
		expect(workerStatusTone("failed")).toBe("err");
		expect(workerStatusTone("interrupted")).toBe("idle");
	});
	it("previews a task on one line", () => {
		expect(taskPreview("  Fix\n\n the   bug ")).toBe("Fix the bug");
		expect(taskPreview("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
	});
});
