/**
 * todo-state.ts: replay of the pi-todo branch snapshot, and run-scoped
 * tracking of which tasks the agent touched (feeds the strip above the composer).
 */
import { describe, expect, it } from "vitest";
import { ConversationTodos, isTaskDetails } from "../../server/todo-state.js";

const result = (tasks: unknown[], nextId: number) => ({
	type: "message",
	message: { role: "toolResult", toolName: "todo", details: { action: "list", params: {}, tasks, nextId } },
});

describe("isTaskDetails", () => {
	it("accepts the persisted TaskDetails shape only", () => {
		expect(isTaskDetails({ tasks: [], nextId: 1 })).toBe(true);
		expect(isTaskDetails({ tasks: [] })).toBe(false);
		expect(isTaskDetails({ exitCode: 0 })).toBe(false);
		expect(isTaskDetails(null)).toBe(false);
	});
});

describe("ConversationTodos", () => {
	it("replays the last todo toolResult on the branch (last-write-wins)", () => {
		const t = new ConversationTodos();
		t.replay([
			result([{ id: 1, subject: "a", status: "pending" }], 2),
			{ type: "message", message: { role: "toolResult", toolName: "bash", details: { exitCode: 0 } } },
			result([{ id: 1, subject: "a", status: "completed" }], 2),
			{ type: "message", message: { role: "toolResult", toolName: "todo", details: "corrupt" } },
		]);
		expect(t.snapshot()).toEqual({
			tasks: [{ id: 1, subject: "a", status: "completed" }],
			nextId: 2,
			runIds: [],
			running: false,
		});
	});

	it("tracks created and changed tasks per run, and resets on the next run", () => {
		const t = new ConversationTodos();
		t.replay([result([{ id: 1, subject: "old", status: "completed" }], 2)]);
		t.startRun();
		expect(t.snapshot().running).toBe(true);
		expect(
			t.apply({
				tasks: [
					{ id: 1, subject: "old", status: "completed" },
					{ id: 2, subject: "new", status: "in_progress", activeForm: "doing" },
				],
				nextId: 3,
			}),
		).toBe(true);
		// Completed-earlier #1 stays out of the run; new #2 is in.
		expect(t.snapshot().runIds).toEqual([2]);
		t.apply({
			tasks: [
				{ id: 1, subject: "old", status: "pending" },
				{ id: 2, subject: "new", status: "completed" },
			],
			nextId: 3,
		});
		expect(t.snapshot().runIds.sort()).toEqual([1, 2]);
		t.endRun();
		// The strip keeps showing the finished run until the next one starts.
		expect(t.snapshot().running).toBe(false);
		expect(t.snapshot().runIds.sort()).toEqual([1, 2]);
		t.startRun();
		expect(t.snapshot().runIds).toEqual([]);
	});

	it("surfaces open tasks when a run only consults the list", () => {
		const t = new ConversationTodos();
		t.replay([
			result(
				[
					{ id: 1, subject: "done", status: "completed" },
					{ id: 2, subject: "open", status: "pending" },
				],
				3,
			),
		]);
		t.startRun();
		t.apply({
			tasks: [
				{ id: 1, subject: "done", status: "completed" },
				{ id: 2, subject: "open", status: "pending" },
			],
			nextId: 3,
		});
		expect(t.snapshot().runIds).toEqual([2]);
	});

	it("ignores non-task details and keeps run ids across a branch re-replay", () => {
		const t = new ConversationTodos();
		t.startRun();
		expect(t.apply({ exitCode: 0 })).toBe(false);
		t.apply({ tasks: [{ id: 1, subject: "a", status: "pending" }], nextId: 2 });
		t.replay([result([{ id: 1, subject: "a", status: "in_progress" }], 2)]);
		const s = t.snapshot();
		expect(s.tasks[0]?.status).toBe("in_progress");
		expect(s.runIds).toEqual([1]);
		expect(s.running).toBe(true);
	});

	it("returns defensive copies", () => {
		const t = new ConversationTodos();
		t.apply({ tasks: [{ id: 1, subject: "a", status: "pending" }], nextId: 2 });
		const s = t.snapshot();
		s.tasks[0]!.subject = "mutated";
		expect(t.snapshot().tasks[0]?.subject).toBe("a");
	});
});
