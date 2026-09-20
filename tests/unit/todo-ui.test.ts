// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TodoPanel, TodoStrip } from "../../web/src/components/TodoList.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { TodoTask, TodosState } from "../../web/src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const task = (
	id: number,
	subject: string,
	status: TodoTask["status"] = "pending",
	over: Partial<TodoTask> = {},
): TodoTask => ({
	id,
	subject,
	status,
	...over,
});

function mount(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => root!.render(createElement(LanguageProvider, null, element)));
	return container;
}

function update(element: ReactElement) {
	act(() => root!.render(createElement(LanguageProvider, null, element)));
}

function state(tasks: TodoTask[], over: Partial<TodosState> = {}): TodosState {
	return { tasks, nextId: tasks.length + 1, runIds: tasks.map((item) => item.id), running: true, ...over };
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("TodoStrip", () => {
	it("filters to run ids, hides deleted rows, and keeps compact rows free of badges", () => {
		const container = mount(
			createElement(TodoStrip, {
				todos: state(
					[
						task(1, "old", "pending"),
						task(2, "finished", "completed", { owner: "worker", blockedBy: [1] }),
						task(3, "removed", "deleted"),
					],
					{ runIds: [2, 3] },
				),
			}),
		);
		const head = container.querySelector(".todo-strip-head") as HTMLButtonElement;
		expect(head.getAttribute("aria-controls")).toBe("todo-run-body");
		const rows = container.querySelectorAll(".todo-strip-list > li");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.textContent).toContain("finished");
		expect(rows[0]?.textContent).not.toContain("worker");
		expect(container.textContent).not.toContain("removed");
	});

	it("collapses when a run completes, labels the last run, and restores idle collapsed", () => {
		localStorage.setItem("dispatch.todoStrip.collapsed", "0");
		const todos = state([task(1, "compile")]);
		const container = mount(createElement(TodoStrip, { todos }));
		const head = () => container.querySelector(".todo-strip-head") as HTMLButtonElement;
		expect(head().getAttribute("aria-expanded")).toBe("true");

		act(() => head().click());
		expect(head().getAttribute("aria-expanded")).toBe("false");
		update(createElement(TodoStrip, { todos: { ...todos, running: false } }));
		expect(container.querySelector(".todo-strip")?.textContent).toContain("Last run");
		expect(head().getAttribute("aria-expanded")).toBe("false");

		// Ending a run must not overwrite the user's live-run preference.
		update(createElement(TodoStrip, { todos }));
		expect(head().getAttribute("aria-expanded")).toBe("false");
		act(() => head().click());
		expect(head().getAttribute("aria-expanded")).toBe("true");

		// A fresh restored idle view is compact even if the stored live preference
		// says expanded.
		act(() => root!.unmount());
		root = null;
		localStorage.setItem("dispatch.todoStrip.collapsed", "0");
		const restored = mount(createElement(TodoStrip, { todos: { ...todos, running: false } }));
		expect(restored.querySelector(".todo-strip-head")?.getAttribute("aria-expanded")).toBe("false");
	});

	it("opens the session view through View all", () => {
		const onViewAll = vi.fn();
		const container = mount(createElement(TodoStrip, { todos: state([task(1, "one")]), onViewAll }));
		act(() => (container.querySelector(".todo-view-all") as HTMLButtonElement).click());
		expect(onViewAll).toHaveBeenCalledOnce();
	});
});

describe("TodoPanel", () => {
	it("orders active and pending work before a collapsed completed group", () => {
		const container = mount(
			createElement(TodoPanel, {
				todos: state([task(1, "pending", "pending"), task(2, "done", "completed"), task(3, "active", "in_progress")]),
			}),
		);
		const openSubjects = Array.from(
			container.querySelectorAll(".todo-session-list:first-of-type .todo-subject"),
			(node) => node.textContent,
		);
		expect(openSubjects).toEqual(["#3active", "#1pending"]);
		expect(container.querySelector(".todo-completed-list")).toBeNull();
		const completedHead = container.querySelector(".todo-completed-head") as HTMLButtonElement;
		expect(completedHead.getAttribute("aria-controls")).toBe("todo-completed-body");
		act(() => completedHead.click());
		expect(container.querySelector("#todo-completed-body")?.textContent).toContain("#2done");
	});

	it("shows a description affordance and expands the description accessibly", () => {
		const container = mount(
			createElement(TodoPanel, {
				todos: state([task(1, "with details", "pending", { description: "More context" })]),
			}),
		);
		const row = container.querySelector(".todo-row-button") as HTMLButtonElement;
		expect(row.querySelector(".todo-description-affordance")).not.toBeNull();
		expect(row.getAttribute("aria-controls")).toBe("todo-description-1");
		expect(container.querySelector("#todo-description-1")).toBeNull();
		act(() => row.click());
		expect(row.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelector("#todo-description-1")?.textContent).toBe("More context");
	});

	it("focuses the panel header when View all requests focus", () => {
		const oldRaf = window.requestAnimationFrame;
		const oldCancel = window.cancelAnimationFrame;
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			callback(0);
			return 0;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
		try {
			const container = mount(
				createElement(TodoPanel, {
					todos: state([task(1, "one")]),
					focusRequest: 1,
				}),
			);
			expect(document.activeElement).toBe(container.querySelector(".todo-panel-head"));
		} finally {
			window.requestAnimationFrame = oldRaf;
			window.cancelAnimationFrame = oldCancel;
		}
	});
});
