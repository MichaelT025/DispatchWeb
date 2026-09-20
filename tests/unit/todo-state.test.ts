/**
 * todo-state.ts: replay of the pi-todo branch snapshot, and run-scoped
 * tracking of which tasks the agent touched (feeds the strip above the composer).
 */
import { describe, expect, it } from "vitest";
import { ConversationTodos, isTaskDetails } from "../../server/todo-state.js";

const result = (tasks: unknown[], nextId: number, action = "list", params: Record<string, unknown> = {}) => ({
	type: "message",
	message: { role: "toolResult", toolName: "todo", details: { action, params, tasks, nextId } },
});

const userMessage = { type: "message", message: { role: "user" } };

const task = (
	id: number,
	subject: string,
	status: "pending" | "in_progress" | "completed" | "deleted" = "pending",
) => ({
	id,
	subject,
	status,
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
			result([task(1, "a")], 2, "create"),
			{ type: "message", message: { role: "toolResult", toolName: "bash", details: { exitCode: 0 } } },
			result([task(1, "a", "completed")], 2, "update", { id: 1 }),
			{ type: "message", message: { role: "toolResult", toolName: "todo", details: "corrupt" } },
		]);
		expect(t.snapshot()).toEqual({
			tasks: [task(1, "a", "completed")],
			nextId: 2,
			runIds: [1],
			running: false,
		});
	});

	it("tracks created and changed tasks per run, and resets on the next run", () => {
		const t = new ConversationTodos();
		t.replay([result([task(1, "old", "completed")], 2, "create")]);
		t.startRun();
		expect(t.snapshot().running).toBe(true);
		expect(
			t.apply({
				tasks: [task(1, "old", "completed"), { ...task(2, "new", "in_progress"), activeForm: "doing" }],
				nextId: 3,
			}),
		).toBe(true);
		// Completed-earlier #1 stays out of the run; new #2 is in.
		expect(t.snapshot().runIds).toEqual([2]);
		t.apply({
			tasks: [task(1, "old", "pending"), task(2, "new", "completed")],
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

	it("does not surface old pending work when a run only lists or gets", () => {
		const t = new ConversationTodos();
		t.replay([result([task(1, "done", "completed"), task(2, "old")], 3, "create")]);
		t.startRun();
		t.apply({
			action: "list",
			params: {},
			tasks: [task(1, "done", "completed"), task(2, "old")],
			nextId: 3,
		});
		t.apply({
			action: "get",
			params: { id: 2 },
			tasks: [task(1, "done", "completed"), task(2, "old")],
			nextId: 3,
		});
		expect(t.snapshot().runIds).toEqual([]);
	});

	it("tracks an unchanged explicit update by params.id", () => {
		const t = new ConversationTodos();
		t.startRun();
		t.apply({ action: "create", params: {}, tasks: [task(1, "a")], nextId: 2 });
		t.startRun();
		t.apply({ action: "update", params: { id: 1 }, tasks: [task(1, "a")], nextId: 2 });
		expect(t.snapshot().runIds).toEqual([1]);
		t.startRun();
		t.apply({
			action: "update",
			params: { id: 1 },
			tasks: [task(1, "a")],
			nextId: 2,
			error: "update requires at least one mutable field",
		});
		expect(t.snapshot().runIds).toEqual([]);
	});

	it("counts metadata changes as task changes", () => {
		const t = new ConversationTodos();
		t.startRun();
		t.apply({
			action: "create",
			params: {},
			tasks: [{ ...task(1, "a"), metadata: { source: "one" } }],
			nextId: 2,
		});
		t.startRun();
		t.apply({
			tasks: [{ ...task(1, "a"), metadata: { source: "two" } }],
			nextId: 2,
		});
		expect(t.snapshot().runIds).toEqual([1]);
	});

	it("restores only the mutations after the latest persisted user boundary", () => {
		const t = new ConversationTodos();
		t.replay([
			result([task(1, "first")], 2, "create"),
			userMessage,
			result([task(1, "first"), task(2, "second")], 3, "create"),
			result([task(1, "first"), task(2, "second")], 3, "list"),
		]);
		expect(t.snapshot().runIds).toEqual([2]);

		const next = new ConversationTodos();
		next.replay([
			result([task(1, "first")], 2, "create"),
			userMessage,
			result([task(1, "first"), task(2, "old")], 3, "list"),
		]);
		expect(next.snapshot().runIds).toEqual([]);
	});

	it("keeps a forced-reset run idle with its task ids across rebind and reconnect", () => {
		const t = new ConversationTodos();
		t.startRun();
		t.apply({ action: "create", params: {}, tasks: [task(1, "touched", "in_progress")], nextId: 2 });
		// forceResetConversation refreshes the live state before taking ownership;
		// replay keeps the in-flight membership while the runtime is still live.
		t.replay([result([task(1, "touched", "in_progress")], 2, "list")]);

		// It then ends tracking before disposal. The replacement bind intentionally
		// retains this state instead of replaying over the ended run.
		t.endRun();
		const activeSnapshot = t.snapshot();
		expect(activeSnapshot).toEqual({
			tasks: [task(1, "touched", "in_progress")],
			nextId: 2,
			runIds: [1],
			running: false,
		});

		// The replacement bind skips replay for this hand-off, so the retained
		// snapshot remains the reconnect snapshot.
		const reconnectSnapshot = t.snapshot();
		expect(reconnectSnapshot).toEqual(activeSnapshot);
	});

	it("keeps live membership when a branch is replayed during a rebind", () => {
		const t = new ConversationTodos();
		t.startRun();
		t.apply({ action: "create", params: {}, tasks: [task(1, "live")], nextId: 2 });
		t.replay([result([task(1, "persisted")], 2, "list")]);
		expect(t.snapshot().tasks).toEqual([task(1, "persisted")]);
		expect(t.snapshot().runIds).toEqual([1]);
		expect(t.snapshot().running).toBe(true);
	});

	it("restores the rebound branch membership after a live run ends", () => {
		const t = new ConversationTodos();
		t.startRun();
		t.apply({ action: "create", params: {}, tasks: [task(1, "live")], nextId: 2 });
		t.endRun();
		t.replay([
			result([task(1, "previous branch")], 2, "create"),
			userMessage,
			result([task(1, "previous branch")], 2, "list"),
		]);
		expect(t.snapshot().runIds).toEqual([]);
		expect(t.snapshot().running).toBe(false);
	});

	it("removes deleted ids and allows ids to be reused after delete or clear", () => {
		const t = new ConversationTodos();
		t.startRun();
		t.apply({ action: "create", params: {}, tasks: [task(1, "a")], nextId: 2 });
		t.apply({ action: "delete", params: { id: 1 }, tasks: [task(1, "a", "deleted")], nextId: 2 });
		expect(t.snapshot().runIds).toEqual([]);
		t.apply({ action: "create", params: {}, tasks: [task(1, "reused")], nextId: 2 });
		expect(t.snapshot().runIds).toEqual([1]);
		t.apply({ action: "clear", params: {}, tasks: [], nextId: 1 });
		expect(t.snapshot().runIds).toEqual([]);
		t.apply({ action: "create", params: {}, tasks: [task(1, "after clear")], nextId: 2 });
		expect(t.snapshot().runIds).toEqual([1]);
	});

	it("ignores non-task details and keeps run ids across a branch re-replay", () => {
		const t = new ConversationTodos();
		t.startRun();
		expect(t.apply({ exitCode: 0 })).toBe(false);
		t.apply({ tasks: [task(1, "a")], nextId: 2 });
		t.replay([result([task(1, "a", "in_progress")], 2, "list")]);
		const s = t.snapshot();
		expect(s.tasks[0]?.status).toBe("in_progress");
		expect(s.runIds).toEqual([1]);
		expect(s.running).toBe(true);
	});

	it("returns defensive copies", () => {
		const t = new ConversationTodos();
		t.apply({ tasks: [task(1, "a")], nextId: 2 });
		const s = t.snapshot();
		s.tasks[0]!.subject = "mutated";
		expect(t.snapshot().tasks[0]?.subject).toBe("a");
	});
});
