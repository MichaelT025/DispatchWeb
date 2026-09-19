/**
 * todo-state.ts — Structured todo list bridged from the pi-todo extension.
 *
 * The CLI's `todo` tool returns a full `{ tasks, nextId }` snapshot in every
 * tool result's `details`, and reconstructs its state by replaying the latest
 * such result on the branch (extensions/pi-todo/state/replay.ts). We do the
 * same here so the browser gets real task objects instead of the TUI widget's
 * pre-rendered text lines. Per conversation: the task list is per session
 * branch, and "current run" ids are the tasks the agent created or changed
 * since the last agent_start (feeds the strip above the composer).
 */

import type { TodoTask, TodosState } from "./protocol.js";

/** Tool name pinned by pi-todo (`tool/types.ts`: TOOL_NAME). */
export const TODO_TOOL_NAME = "todo";
/** Widget key pinned by pi-todo (`todo-overlay.ts`: WIDGET_KEY). The text
 *  widget is suppressed because the structured view replaces it. */
export const TODO_WIDGET_KEY = "rpiv-todos";

interface TaskDetails {
	tasks: TodoTask[];
	nextId: number;
}

/** Mirrors pi-todo's `isTaskDetails` discriminator. */
export function isTaskDetails(value: unknown): value is TaskDetails {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

export class ConversationTodos {
	private tasks: TodoTask[] = [];
	private nextId = 1;
	private runIds = new Set<number>();
	private running = false;

	/** Last-write-wins replay of the branch's `todo` tool results. Keeps the
	 *  run-tracking state (a rebind mid-run must not blank the strip). */
	replay(branch: Iterable<unknown>): void {
		let tasks: TodoTask[] = [];
		let nextId = 1;
		for (const entry of branch) {
			const e = entry as { type?: string; message?: { role?: string; toolName?: string; details?: unknown } };
			if (e.type !== "message") continue;
			const msg = e.message;
			if (msg?.role !== "toolResult" || msg.toolName !== TODO_TOOL_NAME) continue;
			if (!isTaskDetails(msg.details)) continue;
			tasks = msg.details.tasks.map((t) => ({ ...t }));
			nextId = msg.details.nextId;
		}
		this.tasks = tasks;
		this.nextId = nextId;
	}

	/** A run began: the strip starts empty and fills as the agent touches tasks. */
	startRun(): void {
		this.runIds.clear();
		this.running = true;
	}

	endRun(): void {
		this.running = false;
	}

	/** Apply a `todo` tool result. Returns false when the details are not a
	 *  task snapshot (nothing changed). The run set gains every task this
	 *  call created or changed, plus all still-open tasks: a run that merely
	 *  consulted the list (`list` / `get`) should surface the open work, while
	 *  tasks completed in earlier runs stay out of the strip. */
	apply(details: unknown): boolean {
		if (!isTaskDetails(details)) return false;
		const prev = new Map(this.tasks.map((t) => [t.id, t]));
		const next = details.tasks.map((t) => ({ ...t }));
		for (const t of next) {
			const p = prev.get(t.id);
			const changed = !p || p.status !== t.status || p.subject !== t.subject || p.activeForm !== t.activeForm;
			if (changed || t.status === "pending" || t.status === "in_progress") this.runIds.add(t.id);
		}
		this.tasks = next;
		this.nextId = details.nextId;
		return true;
	}

	snapshot(): TodosState {
		return {
			tasks: this.tasks.map((t) => ({ ...t })),
			nextId: this.nextId,
			runIds: [...this.runIds],
			running: this.running,
		};
	}
}

export const EMPTY_TODOS: TodosState = { tasks: [], nextId: 1, runIds: [], running: false };
