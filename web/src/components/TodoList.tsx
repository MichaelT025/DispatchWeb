import { useEffect, useMemo, useState } from "react";
import { FiCheck, FiChevronDown, FiChevronRight, FiLoader } from "react-icons/fi";
import { useT } from "../i18n";
import type { TodoTask, TodosState } from "../types";

/**
 * Read-only views of the pi-todo task list (bridged as structured data by
 * server/todo-state.ts). Two placements:
 *  - `TodoStrip`: collapsible strip above the composer showing only the tasks
 *    the current (or last) agent run touched, mirroring the CLI's aboveEditor
 *    overlay. Auto-hides when the run touched nothing.
 *  - `TodoPanel`: the full session list inside the right workspace panel.
 * Status is carried by a glyph plus (for in_progress) the activeForm label —
 * never by color alone.
 */

const LS_STRIP_COLLAPSED = "dispatch.todoStrip.collapsed";

function visibleTasks(tasks: TodoTask[]): TodoTask[] {
	return tasks.filter((t) => t.status !== "deleted");
}

function StatusGlyph({ status }: { status: TodoTask["status"] }) {
	if (status === "completed") return <FiCheck className="todo-glyph" aria-hidden />;
	if (status === "in_progress") return <FiLoader className="todo-glyph todo-glyph-spin" aria-hidden />;
	return <span className="todo-glyph todo-glyph-pending" aria-hidden />;
}

function TaskRow({ task, byId, showIds }: { task: TodoTask; byId: Map<number, TodoTask>; showIds: boolean }) {
	const t = useT();
	// Only unresolved blockers matter; a completed blocker no longer blocks.
	const blockers = (task.blockedBy ?? []).filter((id) => byId.get(id)?.status !== "completed");
	const label = task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
	return (
		<li className="todo-row" data-status={task.status} title={task.description || undefined}>
			<StatusGlyph status={task.status} />
			<span className="todo-subject">
				{showIds && <span className="todo-id">#{task.id}</span>}
				{label}
			</span>
			{task.owner && <span className="todo-owner">{task.owner}</span>}
			{blockers.length > 0 && task.status !== "completed" && (
				<span className="todo-blocked" title={t("todoBlockedBy", { ids: blockers.map((id) => `#${id}`).join(", ") })}>
					{t("todoBlocked")}
				</span>
			)}
		</li>
	);
}

function counts(tasks: TodoTask[]): { done: number; total: number } {
	let done = 0;
	for (const t of tasks) if (t.status === "completed") done++;
	return { done, total: tasks.length };
}

export function TodoStrip({ todos }: { todos: TodosState }) {
	const t = useT();
	const [collapsed, setCollapsed] = useState<boolean>(() => {
		try {
			return localStorage.getItem(LS_STRIP_COLLAPSED) === "1";
		} catch {
			return false;
		}
	});
	useEffect(() => {
		try {
			localStorage.setItem(LS_STRIP_COLLAPSED, collapsed ? "1" : "0");
		} catch {
			/* private mode */
		}
	}, [collapsed]);

	const byId = useMemo(() => new Map(todos.tasks.map((x) => [x.id, x])), [todos.tasks]);
	const runSet = useMemo(() => new Set(todos.runIds), [todos.runIds]);
	const tasks = useMemo(() => visibleTasks(todos.tasks).filter((x) => runSet.has(x.id)), [todos.tasks, runSet]);
	if (tasks.length === 0) return null;
	const { done, total } = counts(tasks);

	return (
		<section className={`todo-strip${collapsed ? " collapsed" : ""}`} aria-label={t("todoRunTasks")}>
			<button
				type="button"
				className="todo-strip-head"
				aria-expanded={!collapsed}
				onClick={() => setCollapsed((c) => !c)}
			>
				{collapsed ? <FiChevronRight /> : <FiChevronDown />}
				<span className="todo-strip-title">{t("todoRunTasks")}</span>
				<span className="todo-count">
					{done}/{total}
				</span>
				{todos.running && <FiLoader className="todo-glyph todo-glyph-spin todo-strip-live" aria-hidden />}
			</button>
			{!collapsed && (
				<ul className="todo-list">
					{tasks.map((task) => (
						<TaskRow key={task.id} task={task} byId={byId} showIds={false} />
					))}
				</ul>
			)}
		</section>
	);
}

export function TodoPanel({ todos }: { todos: TodosState }) {
	const t = useT();
	const byId = useMemo(() => new Map(todos.tasks.map((x) => [x.id, x])), [todos.tasks]);
	const tasks = useMemo(() => visibleTasks(todos.tasks), [todos.tasks]);
	if (tasks.length === 0) return null;
	const { done, total } = counts(tasks);
	return (
		<div className="widget todo-panel">
			<div className="widget-title">
				<span>{t("todoSessionTasks")}</span>
				<span className="todo-count">
					{done}/{total}
				</span>
			</div>
			<ul className="todo-list">
				{tasks.map((task) => (
					<TaskRow key={task.id} task={task} byId={byId} showIds />
				))}
			</ul>
		</div>
	);
}
