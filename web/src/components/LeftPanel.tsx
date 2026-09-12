import { memo, useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
	FiCheck,
	FiChevronDown,
	FiChevronRight,
	FiChevronsLeft,
	FiEdit2,
	FiFolder,
	FiPlus,
	FiSearch,
	FiTrash2,
	FiX,
} from "react-icons/fi";
import type { ConversationSummary, ProjectSummary, SessionSummary } from "../types";
import { useT } from "../i18n";
import { Logo } from "./Logo";
import { useAppField } from "../app-globals";
import { buildLeftNav, pendingSessionCwds, type NavGroup } from "./left-panel-nav";

/** Props are deliberately NARROW (no whole-ChatState object): every field is
 *  stable while tokens stream in, so the shallow-compared memo() below skips
 *  this entire panel during streaming instead of re-reconciling the file tree
 *  and conversation lists on every delta. Add a prop here when adding a chat
 *  field usage — TypeScript enforces it at the call site. */
interface LeftPanelProps {
	readonly onOpenGlobalSearch: () => void;
	sessionFile: string | null;
	conversations: ConversationSummary[];
	/** Persisted sessions per project cwd (server echoes the queried cwd). */
	sessionsByCwd: Map<string, SessionSummary[]>;
	projects: ProjectSummary[];
	activeConversationId: string;
	panelSend: (
		msg:
			| { type: "new_chat"; cwd?: string | null }
			| { type: "list_sessions"; cwd?: string }
			| { type: "list_projects" }
			| { type: "pick_project_folder" }
			| { type: "switch_session"; path: string }
			| { type: "switch_conversation"; id: string }
			| { type: "set_cwd"; path: string }
			| { type: "remove_project"; path: string }
			| { type: "delete_session"; path: string }
			| { type: "rename_session"; path: string; name: string }
			| { type: "rename_conversation"; id: string; name: string }
			| { type: "dismiss_conversation"; id: string; withFinishedSubagents?: boolean; force?: boolean }
			| { type: "dismiss_finished_subagents"; parentId?: string },
	) => boolean;
	/** True while the panel is actually on screen (desktop: always; mobile:
	 *  only while the drawer is open). Drives lazy loading of the session
	 *  list + recent projects — both scan session files on disk. */
	active: boolean;
	/** Desktop: show the collapse button (mobile drawers close via the topbar). */
	collapsible?: boolean;
	/** Fired when the user clicks the collapse button. */
	onToggleCollapse?: () => void;
}

function formatModified(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const sameDay = d.toDateString() === now.toDateString();
	if (sameDay) {
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

const LS_COLLAPSED_GROUPS = "pi-web-ui:lp-collapsed-groups";

function loadCollapsedGroups(): Set<string> {
	try {
		const raw = localStorage.getItem(LS_COLLAPSED_GROUPS);
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return new Set(parsed.filter((x): x is string => typeof x === "string"));
			}
		}
	} catch {
		// localStorage 不可用（隐私模式/SSR）→ 默认全部展开
	}
	return new Set();
}

export const LeftPanel = memo(function LeftPanel({
	onOpenGlobalSearch,
	sessionFile,
	conversations,
	sessionsByCwd,
	projects,
	activeConversationId,
	panelSend,
	active,
	collapsible,
	onToggleCollapse,
}: LeftPanelProps) {
	const t = useT();
	const currentFile = sessionFile;
	// 连接态与当前工作目录走全局（web/src/app-globals.ts），不再从 App 传
	// —— 这两个值整棵树都要，传参只会越传越漏。
	const ready = useAppField("ready");
	const status = useAppField("status");
	const cwd = useAppField("cwd");
	const currentCwd = cwd;
	const [confirmDel, setConfirmDel] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	/** 每个项目目录的折叠态（Codex 式嵌套树：目录行可单独折叠）。 */
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(loadCollapsedGroups);
	/** 运行对话区右键菜单：scopeId 缺省 = 全部已结束子代理；否则 = 该对话下
	 *  的子代理子树（含自身是子代理时）——递归延伸到子代的子代。 */
	const [convCtx, setConvCtx] = useState<{ x: number; y: number; scopeId?: string } | null>(null);
	/** 右键菜单强行关闭项的两段确认：存已 arm 的 scopeId。 */
	const [forceArmed, setForceArmed] = useState<string | null>(null);
	const closeConvCtx = useCallback(() => {
		setForceArmed(null);
		setConvCtx(null);
	}, []);
	const openConvCtx = useCallback((e: React.MouseEvent, scopeId?: string) => {
		e.preventDefault();
		e.stopPropagation();
		setConvCtx({
			x: Math.min(e.clientX, window.innerWidth - 260),
			y: Math.min(e.clientY, window.innerHeight - 120),
			scopeId,
		});
	}, []);
	/** 展开态切换只改折叠集合；发请求交给下面的可见分组 effect 统一处理。 */
	const toggleGroup = useCallback((path: string) => {
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			try {
				localStorage.setItem(LS_COLLAPSED_GROUPS, JSON.stringify([...next]));
			} catch {}
			return next;
		});
	}, []);
	useEffect(() => {
		if (!convCtx) return;
		const onDown = (e: MouseEvent) => {
			if ((e.target as Element | null)?.closest(".ctx-menu")) return;
			closeConvCtx();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeConvCtx();
		};
		window.addEventListener("mousedown", onDown, true);
		window.addEventListener("keydown", onKey);
		window.addEventListener("blur", closeConvCtx);
		return () => {
			window.removeEventListener("mousedown", onDown, true);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("blur", closeConvCtx);
		};
	}, [convCtx, closeConvCtx]);
	/** scope 内已结束（非 streaming、非当前）的子代理数量——后端按同样口径
	 *  批量移出；为 0 时菜单项禁用。 */
	const finishedSubagentCount = useCallback(
		(list: ConversationSummary[], scopeId?: string): number => {
			if (!scopeId) return list.filter((c) => c.isSubagent && !c.isStreaming && c.id !== activeConversationId).length;
			const byId = new Map(list.map((c) => [c.id, c]));
			const inScope = (c: ConversationSummary): boolean => {
				if (c.id === scopeId)
					return (byId.get(scopeId)?.isSubagent ?? false) && !c.isStreaming && c.id !== activeConversationId;
				let cur: ConversationSummary | undefined = c;
				const seen = new Set<string>();
				while (cur?.parentId) {
					if (cur.parentId === scopeId) return true;
					if (seen.has(cur.parentId)) return false;
					seen.add(cur.parentId);
					cur = byId.get(cur.parentId);
					if (!cur) return false;
				}
				return false;
			};
			return list.filter((c) => c.isSubagent && !c.isStreaming && c.id !== activeConversationId && inScope(c)).length;
		},
		[activeConversationId],
	);

	/** scope 内全部子代理后代数量（不限状态：运行中/已结束/保留中都算）——
	 *  强行全关按钮的计数口径；口径与 finishedSubagentCount 的 inScope 一致。 */
	const countScopeSubagents = useCallback((list: ConversationSummary[], scopeId?: string): number => {
		if (!scopeId) return list.filter((c) => c.isSubagent).length;
		const byId = new Map(list.map((c) => [c.id, c]));
		const inScope = (c: ConversationSummary): boolean => {
			if (c.id === scopeId) return byId.get(scopeId)?.isSubagent ?? false;
			let cur: ConversationSummary | undefined = c;
			const seen = new Set<string>();
			while (cur?.parentId) {
				if (cur.parentId === scopeId) return true;
				if (seen.has(cur.parentId)) return false;
				seen.add(cur.parentId);
				cur = byId.get(cur.parentId);
				if (!cur) return false;
			}
			return false;
		};
		return list.filter((c) => c.isSubagent && inScope(c)).length;
	}, []);

	/** scope 下运行中（streaming）的子代理后代数量——混合情况
	 *  （有运行、也有已结束）同样提示连带关闭，但只关不运行的：
	 *  运行中的不受影响、父对话暂留。口径与 finishedSubagentCount 的 inScope 一致。 */
	const countRunningSubagentDescendants = useCallback((list: ConversationSummary[], scopeId?: string): number => {
		if (!scopeId) return 0;
		const byId = new Map(list.map((c) => [c.id, c]));
		const inScope = (c: ConversationSummary): boolean => {
			let cur: ConversationSummary | undefined = c;
			const seen = new Set<string>();
			while (cur?.parentId) {
				if (cur.parentId === scopeId) return true;
				if (seen.has(cur.parentId)) return false;
				seen.add(cur.parentId);
				cur = byId.get(cur.parentId);
				if (!cur) return false;
			}
			return false;
		};
		return list.filter((c) => c.isSubagent && c.isStreaming && inScope(c)).length;
	}, []);

	useEffect(() => {
		if (!active || !ready || status !== "open") return;
		if (!cwd) return;
		panelSend({ type: "list_sessions" });
		panelSend({ type: "list_projects" });
	}, [active, ready, status, cwd, panelSend]);

	/** 已成功拉到过会话列表的项目 cwd 以 sessionsByCwd 为准（服务器只在收到
	 *  list_sessions 后回推带 cwd 的 sessions）。in-flight 只是防抖标记，回执到达
	 *  即删；这里不把「已发送」当成「已成功」，否则一次发送失败或重连丢包会把
	 *  项目永久锁死为空。 */
	const inFlightCwds = useRef<Set<string>>(new Set());
	/** WebSocket 打开代数：重连时 +1，用来强制重拉已缓存展开分组的会话列表
	 *  （断线期间的磁盘变动不会被旧缓存反映出来）。 */
	const [liveToken, setLiveToken] = useState(0);
	const wasLive = useRef(false);
	const lastRefreshToken = useRef(0);

	// 连接从「未就绪」变为 open：清掉在途标记（旧 socket 的请求永远不会回执），
	// 并递增代数触发一次强制刷新。
	useEffect(() => {
		const live = ready && status === "open";
		if (live && !wasLive.current) {
			inFlightCwds.current.clear();
			setLiveToken((n) => n + 1);
		}
		wasLive.current = live;
	}, [ready, status]);

	const navGroups = useMemo(
		() => buildLeftNav(projects, conversations, sessionsByCwd, currentCwd),
		[projects, conversations, sessionsByCwd, currentCwd],
	);

	// 可见且展开的项目都在这里惰性拉取历史：新发现的非当前项目、默认展开但从未
	// 加载的分组都会补上；折叠分组不动。已加载成功的分组仅在重连刷新时重拉一次。
	useEffect(() => {
		if (!active || !ready || status !== "open") return;
		const loaded = new Set(sessionsByCwd.keys());
		// 回执到达 → 清在途标记，避免「发送成功但未回执」与「真正已加载」混淆。
		for (const path of [...inFlightCwds.current]) {
			if (loaded.has(path)) inFlightCwds.current.delete(path);
		}
		const refresh = liveToken !== lastRefreshToken.current;
		lastRefreshToken.current = liveToken;
		const pending = pendingSessionCwds(navGroups, collapsedGroups, loaded, inFlightCwds.current, refresh);
		for (const path of pending) {
			inFlightCwds.current.add(path);
			// 发送失败（socket 未开）不驻留标记，下次连接/依赖变化时可重试。
			if (!panelSend({ type: "list_sessions", cwd: path })) inFlightCwds.current.delete(path);
		}
	}, [active, ready, status, sessionsByCwd, navGroups, collapsedGroups, liveToken, panelSend]);

	const displayName = (s: SessionSummary): string => {
		const title = s.name || s.firstMessage.trim();
		return title.length > 0 ? title : t("emptyChat");
	};

	const delButton = (key: string, hint: string, confirmHint: string, onConfirm: () => void, icon?: React.ReactNode) => {
		const armed = confirmDel === key;
		return (
			<button
				type="button"
				className={`lp-del ${armed ? "confirm" : ""}`}
				title={armed ? confirmHint : hint}
				onClick={(e) => {
					e.stopPropagation();
					if (armed) {
						setConfirmDel(null);
						onConfirm();
					} else {
						setConfirmDel(key);
					}
				}}
			>
				{armed ? <FiCheck /> : (icon ?? <FiTrash2 />)}
			</button>
		);
	};

	const renderConversationRow = (c: ConversationSummary, depth: number) => {
		const active = activeConversationId === c.id;
		const key = `conv:${c.id}`;
		const nFinished = finishedSubagentCount(conversations, c.id);
		const nRunning = countRunningSubagentDescendants(conversations, c.id);
		const nAll = countScopeSubagents(conversations, c.id);
		return (
			<div
				className={`lp-row${depth > 0 ? " lp-sub" : ""}`}
				key={c.id}
				style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
				onMouseLeave={() => setConfirmDel((k) => (k === key ? null : k))}
				onContextMenu={(e) => openConvCtx(e, c.id)}
			>
				<button
					type="button"
					className={`session-item ${active ? "active" : ""}`}
					title={c.title}
					onClick={() => {
						if (!active) panelSend({ type: "switch_conversation", id: c.id });
					}}
				>
					<span className="session-info">
						{renaming === key ? (
							<input
								autoFocus
								className="session-rename-input"
								value={renameDraft}
								placeholder={t("renameSessionPlaceholder")}
								onClick={(e) => e.stopPropagation()}
								onChange={(e) => setRenameDraft(e.target.value)}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter" && !e.nativeEvent.isComposing) {
										const name = renameDraft.trim();
										if (name) panelSend({ type: "rename_conversation", id: c.id, name });
										setRenaming(null);
									} else if (e.key === "Escape") {
										setRenaming(null);
									}
								}}
								onBlur={() => setRenaming(null)}
							/>
						) : (
							<span className="session-title">
								{c.isSubagent && <span className="subagent-badge">{t("subagentBadge")}</span>}
								{c.title}
								{c.error && <span className="conv-error-badge" title={t("convErrorBadge", { error: c.error })} />}
							</span>
						)}
						{renaming === key ? null : (
							<span className="session-sub">{active ? t("current") : t("messageCount", { n: c.messageCount })}</span>
						)}
					</span>
					{c.isStreaming && <span className="conv-streaming" title={t("streaming")} />}
				</button>
				<button
					type="button"
					className="lp-del lp-rename"
					title={t("renameSession")}
					onClick={(e) => {
						e.stopPropagation();
						setConfirmDel(null);
						setRenameDraft(c.title);
						setRenaming(key);
					}}
				>
					<FiEdit2 />
				</button>
				{(() => {
					const armed = confirmDel === key;
					// 无子代理 + 空闲：两段确认直接移出（active 也可，后端自动让出）。
					if (nAll === 0 && !c.isStreaming) {
						return delButton(
							key,
							t("dismissConversation"),
							t("dismissConversationConfirm"),
							() => panelSend({ type: "dismiss_conversation", id: c.id }),
							<FiX />,
						);
					}
					// 无子代理 + 运行中：两段确认强行关闭（中止本轮）。
					if (nAll === 0) {
						return delButton(
							key,
							t("dismissConversation"),
							t("dismissStreamingConfirm"),
							() => panelSend({ type: "dismiss_conversation", id: c.id, force: true }),
							<FiX />,
						);
					}
					// 有子代理后代：点 X 展开两个选项（只关已结束 / 强行全关）。
					if (!armed) {
						return (
							<button
								type="button"
								className="lp-del"
								title={t("dismissConversation")}
								onClick={(e) => {
									e.stopPropagation();
									setConfirmDel(key);
								}}
							>
								<FiX />
							</button>
						);
					}
					return (
						<span className="lp-del-group">
							{nFinished > 0 && (
								<button
									type="button"
									className="lp-del-opt"
									title={t("dismissFinishedSubagentsScoped", { n: nFinished })}
									onClick={(e) => {
										e.stopPropagation();
										setConfirmDel(null);
										panelSend({ type: "dismiss_finished_subagents", parentId: c.id });
									}}
								>
									{t("dismissFinishedOnly", { n: nFinished })}
								</button>
							)}
							<button
								type="button"
								className="lp-del-opt danger"
								title={t("forceDismissTitle", { n: nAll, m: nRunning })}
								onClick={(e) => {
									e.stopPropagation();
									setConfirmDel(null);
									panelSend({ type: "dismiss_conversation", id: c.id, force: true });
								}}
							>
								{t("dismissForceAll", { n: nAll })}
							</button>
						</span>
					);
				})()}
				{c.isStreaming && (
					<span
						className="lp-row-stalled"
						title={t("streaming")}
						style={{ position: "absolute", right: 28, top: "50%", transform: "translateY(-50%)" }}
					/>
				)}
			</div>
		);
	};

	const renderSessionRow = (s: SessionSummary) => {
		const active = currentFile === s.path;
		const key = `sess:${s.path}`;
		return (
			<div className="lp-row" key={s.path} onMouseLeave={() => setConfirmDel((k) => (k === key ? null : k))}>
				<button
					type="button"
					className={`session-item ${active ? "active" : ""}`}
					title={s.path}
					onClick={() => {
						if (renaming) return;
						if (!active) panelSend({ type: "switch_session", path: s.path });
					}}
				>
					<span className="session-info">
						{renaming === s.path ? (
							<input
								autoFocus
								className="session-rename-input"
								value={renameDraft}
								placeholder={t("renameSessionPlaceholder")}
								onClick={(e) => e.stopPropagation()}
								onChange={(e) => setRenameDraft(e.target.value)}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter" && !e.nativeEvent.isComposing) {
										const name = renameDraft.trim();
										if (name) panelSend({ type: "rename_session", path: s.path, name });
										setRenaming(null);
									} else if (e.key === "Escape") {
										setRenaming(null);
									}
								}}
								onBlur={() => setRenaming(null)}
							/>
						) : (
							<span className="session-title">{displayName(s)}</span>
						)}
						{renaming === s.path ? null : (
							<span className="session-sub">
								{active ? t("current") : t("messageCount", { n: s.messageCount })}
								{s.source === "tui" && (
									<span className="session-src" title={t("tuiTip")}>
										TUI
									</span>
								)}
							</span>
						)}
					</span>
					<span className="session-time">{formatModified(s.modified)}</span>
				</button>
				<button
					type="button"
					className="lp-del lp-rename"
					title={t("renameSession")}
					onClick={(e) => {
						e.stopPropagation();
						setConfirmDel(null);
						setRenameDraft(s.name ?? "");
						setRenaming(s.path);
					}}
				>
					<FiEdit2 />
				</button>
				{delButton(key, t("deleteSession"), t("deleteSessionConfirm"), () =>
					panelSend({ type: "delete_session", path: s.path }),
				)}
			</div>
		);
	};

	const groups = navGroups.filter((g) => g.isProject);
	const recents = navGroups.filter((g) => !g.isProject);

	return (
		<aside className="panel panel-left lp-panel">
			{/* Astra 品牌 + 突出的「新对话」——替代旧顶栏的 new_chat 入口。 */}
			<div className="lp-brand">
				<span className="lp-brand-title">
					<Logo size={20} />
					<span className="lp-brand-name">PiAstra</span>
				</span>
				<span className="lp-brand-actions">
					<button
						type="button"
						className="lp-icon-btn lp-search"
						title={t("searchGlobal")}
						aria-label={t("searchGlobal")}
						onClick={onOpenGlobalSearch}
					>
						<FiSearch />
					</button>
					{collapsible && onToggleCollapse && (
						<button
							type="button"
							className="panel-collapse-btn lp-brand-collapse lp-icon-btn"
							title={t("collapsePanel")}
							onClick={onToggleCollapse}
						>
							<FiChevronsLeft />
						</button>
					)}
				</span>
			</div>
			<button
				type="button"
				className="lp-new-chat"
				title={t("newChatTip")}
				onClick={() => panelSend({ type: "new_chat", cwd: null })}
			>
				<FiEdit2 />
				<span>{t("newChat")}</span>
			</button>
			<div className="lp-section-label">
				<span>{t("recentProjects")}</span>
				<button
					type="button"
					className="lp-icon-btn lp-add-project"
					title={t("addProject")}
					aria-label={t("addProject")}
					disabled={!ready}
					onClick={() => panelSend({ type: "pick_project_folder" })}
				>
					<FiPlus />
				</button>
			</div>
			{/* Codex 式统一导航树：项目目录为顶层分组，运行中的对话与当前项目的历史
			    会话按 cwd 嵌套在各目录下（未登记项目的运行对话单独成组，不丢弃）。 */}
			<nav className="lp-nav">
				{groups.length === 0 ? (
					<div className="panel-empty">{t("noHistory")}</div>
				) : (
					groups.map((g: NavGroup) => {
						const collapsed = collapsedGroups.has(g.path);
						const count = g.conversations.length + g.sessions.length;
						return (
							<section
								key={g.path}
								className={`lp-group${g.isCurrent ? " current" : ""}${collapsed ? " collapsed" : ""}`}
							>
								<div
									className="lp-group-head"
									onMouseLeave={() => setConfirmDel((k) => (k === `proj:${g.path}` ? null : k))}
								>
									<button
										type="button"
										className="lp-group-toggle"
										title={collapsed ? t("expandSection") : t("collapseSection")}
										aria-expanded={!collapsed}
										aria-label={g.label}
										onClick={() => toggleGroup(g.path)}
									>
										{collapsed ? <FiChevronRight /> : <FiChevronDown />}
									</button>
									<button
										type="button"
										className={`lp-group-main${g.isCurrent ? " active" : ""}`}
										title={g.path}
										onClick={() => {
											if (!g.isCurrent) panelSend({ type: "set_cwd", path: g.path });
										}}
									>
										<FiFolder className="lp-group-icon" />
										<span className="lp-group-label">{g.label}</span>
										{count > 0 && <span className="lp-group-count">{count}</span>}
									</button>
									<button
										type="button"
										className="lp-del lp-project-new"
										title={t("newChat")}
										aria-label={`${t("newChat")} — ${g.label}`}
										onClick={() => {
											setCollapsedGroups((prev) => {
												const next = new Set(prev);
												next.delete(g.path);
												return next;
											});
											panelSend({ type: "new_chat", cwd: g.path });
										}}
									>
										<FiEdit2 />
									</button>
									{g.isProject &&
										delButton(`proj:${g.path}`, t("deleteProject"), t("deleteProjectConfirm"), () =>
											panelSend({ type: "remove_project", path: g.path }),
										)}
								</div>
								{!collapsed && (g.conversations.length > 0 || g.sessions.length > 0) && (
									<div className="lp-group-body">
										{g.conversations.length > 0 && (
											<div className="lp-group-convs" onContextMenu={(e) => openConvCtx(e)}>
												{g.conversations.map(({ c, depth }) => renderConversationRow(c, depth))}
											</div>
										)}
										{g.sessions.map((s) => renderSessionRow(s))}
									</div>
								)}
								{!collapsed && g.isCurrent && g.conversations.length === 0 && g.sessions.length === 0 && (
									<div className="panel-empty">{t("noHistory")}</div>
								)}
							</section>
						);
					})
				)}
				<div className="lp-section-label">{t("recents")}</div>
				<div className="lp-recents">
					{recents.flatMap((g) => g.conversations).map(({ c, depth }) => renderConversationRow(c, depth))}
					{recents
						.flatMap((g) => g.sessions)
						.sort((a, b) => b.modified - a.modified)
						.map(renderSessionRow)}
				</div>
			</nav>
			<footer className="lp-footer">
				<span className="lp-footer-avatar" aria-hidden="true">
					<Logo size={12} />
				</span>
				<span className="lp-footer-project" title={cwd}>
					{cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop()}
				</span>
				<span
					className="lp-footer-status"
					title={ready ? t("connected") : status === "closed" ? t("reconnecting") : t("connecting")}
				>
					<span className={`conn-dot ${ready ? "ok" : "busy"}`} />
					<span className="lp-footer-conn">
						{ready ? t("connected") : status === "closed" ? t("reconnecting") : t("connecting")}
					</span>
				</span>
			</footer>
			{convCtx && (
				<div
					className="ctx-menu"
					style={{ left: convCtx.x, top: convCtx.y }}
					onContextMenu={(e) => {
						e.preventDefault();
						e.stopPropagation();
					}}
				>
					<button
						type="button"
						className="ctx-item"
						title={finishedSubagentCount(conversations, convCtx.scopeId) === 0 ? t("noFinishedSubagents") : undefined}
						disabled={finishedSubagentCount(conversations, convCtx.scopeId) === 0}
						onClick={() => {
							if (convCtx.scopeId) panelSend({ type: "dismiss_finished_subagents", parentId: convCtx.scopeId });
							else panelSend({ type: "dismiss_finished_subagents" });
							closeConvCtx();
						}}
					>
						<FiX />
						<span>
							{finishedSubagentCount(conversations, convCtx.scopeId) === 0
								? t("noFinishedSubagents")
								: convCtx.scopeId
									? t("dismissFinishedSubagentsScoped", { n: finishedSubagentCount(conversations, convCtx.scopeId) })
									: t("dismissFinishedSubagents", { n: finishedSubagentCount(conversations, convCtx.scopeId) })}
						</span>
					</button>
					{convCtx.scopeId && (
						<button
							type="button"
							className={forceArmed === convCtx.scopeId ? "ctx-item danger armed" : "ctx-item danger"}
							title={forceArmed === convCtx.scopeId ? t("forceDismissConfirm") : t("forceDismissConversation")}
							onClick={() => {
								const scope = convCtx.scopeId as string;
								if (forceArmed === scope) {
									panelSend({ type: "dismiss_conversation", id: scope, force: true });
									setForceArmed(null);
									closeConvCtx();
								} else {
									setForceArmed(scope);
								}
							}}
						>
							<FiX />
							<span>{forceArmed === convCtx.scopeId ? t("forceDismissConfirm") : t("forceDismissConversation")}</span>
						</button>
					)}
				</div>
			)}
		</aside>
	);
});
