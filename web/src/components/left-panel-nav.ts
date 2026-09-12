/**
 * Left-panel navigation tree — pure, testable derivation of the unified
 * sidebar (Codex-style: project directories with chats nested under each).
 *
 * Kept side-effect free so the grouping/nesting/order rules can be unit-tested
 * without a DOM. The component only renders whatever this returns.
 */
import type { ConversationSummary, ProjectSummary, SessionSummary } from "../types";

/** A running conversation flattened into parent-first tree order with depth. */
export interface NavConversation {
	c: ConversationSummary;
	depth: number;
}

/** One top-level navigation group (a workspace directory). */
export interface NavGroup {
	/** Absolute workspace directory this group represents. */
	path: string;
	/** Directory basename for display. */
	label: string;
	/** True when the path is a known recent project (delete affordance shown). */
	isProject: boolean;
	/** True when this group is the active working directory. */
	isCurrent: boolean;
	/** Sort key: project last-used epoch ms; ungrouped chats = 0. */
	lastUsed: number;
	/** Running conversations nested under this group (subagent tree flattened). */
	conversations: NavConversation[];
	/** History sessions under this group. Only the CURRENT project has data —
	 *  the wire `sessions` list is scoped to the active cwd (see AGENTS.md). */
	sessions: SessionSummary[];
}

/** Directory basename, tolerant of trailing and mixed separators. */
export function basename(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	if (!trimmed) return path; // all separators (e.g. "/") — return as-is
	const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Flatten one project's running conversations into a parent-first tree with
 * depth. Children whose parent is outside the list are treated as roots, and
 * any orphaned entry is appended at root depth (idempotent via a seen set).
 */
export function flattenConversations(list: ConversationSummary[]): NavConversation[] {
	const byId = new Map(list.map((c) => [c.id, c]));
	const kids = new Map<string, ConversationSummary[]>();
	const roots: ConversationSummary[] = [];
	for (const c of list) {
		if (c.parentId && byId.has(c.parentId)) {
			const arr = kids.get(c.parentId) ?? [];
			arr.push(c);
			kids.set(c.parentId, arr);
		} else {
			roots.push(c);
		}
	}
	const rows: NavConversation[] = [];
	const seen = new Set<string>();
	const append = (c: ConversationSummary, depth: number): void => {
		if (seen.has(c.id)) return;
		seen.add(c.id);
		rows.push({ c, depth });
		for (const child of kids.get(c.id) ?? []) append(child, depth + 1);
	};
	for (const root of roots) append(root, 0);
	for (const orphan of list) append(orphan, 0);
	return rows;
}

function makeGroup(
	path: string,
	isProject: boolean,
	lastUsed: number,
	convsByCwd: Map<string, ConversationSummary[]>,
	sessions: SessionSummary[],
	currentCwd: string,
): NavGroup {
	const isCurrent = path === currentCwd;
	return {
		path,
		label: basename(path),
		isProject,
		isCurrent,
		lastUsed,
		conversations: flattenConversations(convsByCwd.get(path) ?? []),
		sessions: isCurrent ? sessions : [],
	};
}

/**
 * Build the unified sidebar tree:
 *
 * - Every known recent project becomes a top-level directory group.
 * - Running conversations are nested under the group matching their workspace
 *   cwd (a subagent child inherits its parent's cwd).
 * - Running conversations whose cwd is not a known project are kept as
 *   "ungrouped" groups (one per cwd) so they are never silently dropped.
 * - History sessions are attached only to the current project: the protocol's
 *   `sessions` payload is scoped to the active cwd, so fabricating per-project
 *   history for other workspaces is impossible without a server seam.
 *
 * Order: current project first, then known projects by last-used desc, then
 * ungrouped cwds by label asc.
 */
export function buildLeftNav(
	projects: ProjectSummary[],
	conversations: ConversationSummary[],
	sessions: SessionSummary[],
	currentCwd: string,
): NavGroup[] {
	const byId = new Map(conversations.map((c) => [c.id, c]));
	const convsByCwd = new Map<string, ConversationSummary[]>();
	for (const c of conversations) {
		const groupCwd = c.parentId ? (byId.get(c.parentId)?.cwd ?? c.cwd) : c.cwd;
		const arr = convsByCwd.get(groupCwd) ?? [];
		arr.push(c);
		convsByCwd.set(groupCwd, arr);
	}

	const known = new Map(projects.map((p) => [p.path, p]));
	const groups: NavGroup[] = [];

	for (const p of projects) {
		groups.push(makeGroup(p.path, true, p.lastUsed, convsByCwd, sessions, currentCwd));
	}

	const ungroupedCwds = [...convsByCwd.keys()].filter((cwd) => !known.has(cwd)).sort();
	for (const cwd of ungroupedCwds) {
		groups.push(makeGroup(cwd, false, 0, convsByCwd, sessions, currentCwd));
	}

	groups.sort((a, b) => {
		if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
		if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
		if (a.isProject) return b.lastUsed - a.lastUsed;
		return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
	});
	return groups;
}
