import { describe, expect, it } from "vitest";
import {
	basename,
	buildLeftNav,
	flattenConversations,
	pendingSessionCwds,
	stableProjectOrder,
	type NavGroup,
} from "../../web/src/components/left-panel-nav.js";
import type { ConversationSummary, ProjectSummary, SessionSummary, WorktreeSummary } from "../../web/src/types.js";

function conv(id: string, cwd: string): ConversationSummary {
	return { id, title: id, cwd, messageCount: 1, isStreaming: false };
}

function project(path: string, lastUsed: number): ProjectSummary {
	return { path, lastUsed };
}

function session(path: string, modified = 1000): SessionSummary {
	return { path, firstMessage: "hi", messageCount: 1, modified, source: "web" };
}

describe("basename", () => {
	it("剥离目录名（支持正反斜杠与尾部分隔符）", () => {
		expect(basename("/a/b/c")).toBe("c");
		expect(basename("C:\\Users\\x\\proj")).toBe("proj");
		expect(basename("/a/b/")).toBe("b");
		expect(basename("/")).toBe("/"); // 全分隔符原样返回，不抛错
	});
});

describe("flattenConversations", () => {
	it("keeps list order, all rows at root depth", () => {
		const rows = flattenConversations([conv("root", "/p"), conv("kid", "/p"), conv("grand", "/p")]);
		expect(rows.map((r) => [r.c.id, r.depth])).toEqual([
			["root", 0],
			["kid", 0],
			["grand", 0],
		]);
	});

	it("a single conversation is one root row", () => {
		const rows = flattenConversations([conv("kid", "/p")]);
		expect(rows).toEqual([{ c: expect.objectContaining({ id: "kid" }), depth: 0 }]);
	});
});

describe("buildLeftNav", () => {
	it("空输入返回空数组", () => {
		expect(buildLeftNav([], [], new Map(), "/p")).toEqual([]);
	});

	it("项目目录成为顶层分组，运行中的对话按其 cwd 嵌套", () => {
		const groups = buildLeftNav([project("/a", 2), project("/b", 1)], [conv("c1", "/a")], new Map(), "/a");
		expect(groups.map((g) => g.path)).toEqual(["/a", "/b"]);
		expect(groups[0].isCurrent).toBe(true);
		expect(groups[0].conversations.map((r) => r.c.id)).toEqual(["c1"]);
		expect(groups[1].conversations).toEqual([]);
	});

	it("projects by lastUsed desc; the current one does not jump ahead", () => {
		const groups = buildLeftNav([project("/old", 1), project("/new", 9), project("/mid", 5)], [], new Map(), "/mid");
		expect(groups.map((g) => g.path)).toEqual(["/new", "/mid", "/old"]);
		expect(groups[1].isCurrent).toBe(true);
	});

	it("未登记项目的运行对话保留为未分组（不静默丢弃）", () => {
		const groups = buildLeftNav([project("/a", 1)], [conv("orphan", "/zzz")], new Map(), "/a");
		const ungrouped = groups.find((g) => !g.isProject) as NavGroup;
		expect(ungrouped).toBeDefined();
		expect(ungrouped.path).toBe("/zzz");
		expect(ungrouped.label).toBe("zzz");
		expect(ungrouped.conversations.map((r) => r.c.id)).toEqual(["orphan"]);
		// 已知项目仍排在未分组之前
		expect(groups[0].path).toBe("/a");
	});

	it("历史会话按 cwd 分别挂到各自项目（服务器按项目回推）", () => {
		const sa = [session("/s/a")];
		const sb = [session("/s/b1"), session("/s/b2")];
		const groups = buildLeftNav(
			[project("/a", 2), project("/b", 1)],
			[],
			new Map([
				["/a", sa],
				["/b", sb],
			]),
			"/a",
		);
		const a = groups.find((g) => g.path === "/a") as NavGroup;
		const b = groups.find((g) => g.path === "/b") as NavGroup;
		expect(a.sessions).toEqual(sa);
		expect(b.sessions).toEqual(sb);
	});

	it("未请求过会话的项目显示空历史（不伪造当前项目数据）", () => {
		const s = [session("/s/1")];
		const groups = buildLeftNav([project("/a", 2), project("/b", 1)], [], new Map([["/a", s]]), "/a");
		const a = groups.find((g) => g.path === "/a") as NavGroup;
		const b = groups.find((g) => g.path === "/b") as NavGroup;
		expect(a.sessions).toEqual(s);
		expect(b.sessions).toEqual([]);
	});

	it("当前 cwd 不在项目列表时，会话挂到对应未分组目录", () => {
		const s = [session("/s/1")];
		const groups = buildLeftNav([project("/a", 1)], [conv("c", "/cur")], new Map([["/cur", s]]), "/cur");
		const cur = groups.find((g) => g.path === "/cur") as NavGroup;
		expect(cur.isCurrent).toBe(true);
		expect(cur.sessions).toEqual(s);
	});
});

describe("pendingSessionCwds", () => {
	// Two projects discovered by list_projects; /a is the active cwd, /b is not.
	const groups = () => buildLeftNav([project("/a", 2), project("/b", 1)], [], new Map(), "/a");

	it("默认展开时，非当前但从未加载的项目也要拉取（初始空历史场景）", () => {
		const pending = pendingSessionCwds(groups(), new Set(), new Set(), new Set());
		expect(pending).toEqual(["/b"]);
	});

	it("新发现的项目（后于分组出现）同样补拉，已加载的不重复", () => {
		const g = buildLeftNav([project("/a", 3), project("/b", 2), project("/c", 1)], [], new Map(), "/a");
		expect(pendingSessionCwds(g, new Set(), new Set(["/b"]), new Set())).toEqual(["/c"]);
	});

	it("折叠的分组不拉取，展开后才进入待拉取", () => {
		const collapsed = new Set(["/b"]);
		expect(pendingSessionCwds(groups(), collapsed, new Set(), new Set())).toEqual([]);
		expect(pendingSessionCwds(groups(), new Set(), new Set(), new Set())).toEqual(["/b"]);
	});

	it("当前 cwd 由无参 list_sessions 负责，不在分组拉取内", () => {
		const g = buildLeftNav([project("/a", 2), project("/b", 1)], [], new Map([["/a", [session("/s/a")]]]), "/a");
		expect(pendingSessionCwds(g, new Set(), new Set(["/a"]), new Set())).toEqual(["/b"]);
	});

	it("已成功加载的分组不重复请求", () => {
		expect(pendingSessionCwds(groups(), new Set(), new Set(["/b"]), new Set())).toEqual([]);
	});

	it("在途请求不重复请求（防空转/风暴）", () => {
		expect(pendingSessionCwds(groups(), new Set(), new Set(), new Set(["/b"]))).toEqual([]);
	});

	it("发送失败后（无在途标记）下一轮仍可重试", () => {
		// 发送失败 = 未写入 inFlight；下一轮依赖变化时仍应待拉取。
		expect(pendingSessionCwds(groups(), new Set(), new Set(), new Set())).toEqual(["/b"]);
	});

	it("重连刷新强制重拉已加载但展开的分组", () => {
		expect(pendingSessionCwds(groups(), new Set(), new Set(["/b"]), new Set(), true)).toEqual(["/b"]);
	});

	it("重连刷新也不碰折叠分组或在途请求", () => {
		expect(pendingSessionCwds(groups(), new Set(["/b"]), new Set(["/b"]), new Set(), true)).toEqual([]);
		expect(pendingSessionCwds(groups(), new Set(), new Set(["/b"]), new Set(["/b"]), true)).toEqual([]);
	});
});

it("keeps persisted projectless chats available after reconnect", () => {
	const groups = buildLeftNav([project("/work", 1)], [], new Map([["/chats", [session("/saved.jsonl")]]]), "/work");
	expect(groups.find((g) => !g.isProject)?.sessions[0].path).toBe("/saved.jsonl");
});

describe("disambiguateLabels", () => {
	const proj = (path: string, lastUsed = 1) => ({ path, lastUsed });
	it("colliding project basenames grow the nearest distinguishing parent", () => {
		const groups = buildLeftNav(
			[proj("C:/Users/me/Documents/Personal/PiAstra", 3), proj("C:\\Users\\me\\.codex\\worktrees\\4cb0\\PiAstra", 2)],
			[],
			new Map(),
			"",
		);
		expect(groups.map((g) => g.label)).toEqual(["Personal/PiAstra", "4cb0/PiAstra"]);
	});
	it("unique basenames are left alone", () => {
		const groups = buildLeftNav([proj("/a/x"), proj("/b/y")], [], new Map(), "");
		expect(groups.map((g) => g.label)).toEqual(["x", "y"]);
	});
	it("keeps growing when the parent collides too", () => {
		const groups = buildLeftNav([proj("/one/src/app"), proj("/two/src/app")], [], new Map(), "");
		expect(groups.map((g) => g.label).sort()).toEqual(["one/src/app", "two/src/app"]);
	});
});

describe("case folding + live/history dedupe", () => {
	it("case variants of one Windows cwd land in one group, history file of a running chat is hidden", () => {
		const sess = (path: string): SessionSummary => ({ path, firstMessage: path, messageCount: 1, modified: 1 });
		const running = { ...conv("c1", "c:/Users/me/X-Lib"), sessionPath: "C:/s/--C--X-Lib--/a.jsonl" };
		const groups = buildLeftNav(
			[{ path: "C:/Users/me/X-Lib", lastUsed: 1 }],
			[running],
			new Map([["C:/Users/me/X-Lib", [sess("C:/s/--C--X-Lib--/a.jsonl"), sess("C:/s/--C--X-Lib--/b.jsonl")]]]),
			"",
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].conversations.map((x) => x.c.id)).toEqual(["c1"]);
		expect(groups[0].sessions.map((s) => s.path)).toEqual(["C:/s/--C--X-Lib--/b.jsonl"]);
	});
});

describe("stableProjectOrder", () => {
	it("keeps the first-seen order when lastUsed later reorders; new projects enter at the top", () => {
		const order: string[] = [];
		const first = stableProjectOrder(buildLeftNav([project("/a", 3), project("/b", 2)], [], new Map(), "/a"), order);
		expect(first.map((g) => g.path)).toEqual(["/a", "/b"]);
		// /b was just switched to and got the newest lastUsed — it must stay second
		const bumped = stableProjectOrder(buildLeftNav([project("/a", 3), project("/b", 9)], [], new Map(), "/b"), order);
		expect(bumped.map((g) => g.path)).toEqual(["/a", "/b"]);
		// a newly opened project appears at the top; a removed one drops out
		const next = stableProjectOrder(buildLeftNav([project("/c", 10), project("/b", 9)], [], new Map(), "/c"), order);
		expect(next.map((g) => g.path)).toEqual(["/c", "/b"]);
	});
	it("detached groups stay after the projects", () => {
		const order: string[] = [];
		const g = stableProjectOrder(buildLeftNav([project("/a", 1)], [conv("x", "/zzz")], new Map(), "/a"), order);
		expect(g.map((x) => x.isProject)).toEqual([true, false]);
	});
});

describe("worktrees", () => {
	const wt = (path: string, branch: string | null, isMain = false): WorktreeSummary => ({
		path,
		branch,
		head: "abcdef12",
		isMain,
		locked: false,
		managed: !isMain,
	});
	const repo = (): ProjectSummary => ({
		path: "/repo",
		lastUsed: 5,
		worktrees: [wt("/repo", "main", true), wt("/home/.pi/worktrees/repo/feat-x", "feat/x"), wt("/wt/detached", null)],
	});

	it("chats and sessions in a linked worktree nest under the repository with a branch badge", () => {
		const sessions = new Map<string, SessionSummary[]>([
			["/repo", [session("/s/main.jsonl", 10)]],
			["/home/.pi/worktrees/repo/feat-x", [session("/s/feat.jsonl", 20)]],
			["/wt/detached", [session("/s/det.jsonl", 15)]],
		]);
		const groups = buildLeftNav(
			[repo()],
			[conv("c-main", "/repo"), conv("c-feat", "/home/.pi/worktrees/repo/feat-x")],
			sessions,
			"/repo",
		);
		expect(groups).toHaveLength(1);
		const g = groups[0];
		expect(g.isProject).toBe(true);
		expect(g.isCurrent).toBe(true);
		expect(g.conversations.map((r) => [r.c.id, r.branch])).toEqual([
			["c-main", undefined],
			["c-feat", "feat/x"],
		]);
		// merged across checkouts, newest first
		expect(g.sessions.map((s) => s.path)).toEqual(["/s/feat.jsonl", "/s/det.jsonl", "/s/main.jsonl"]);
		expect(g.sessionBranches.get("/s/feat.jsonl")).toBe("feat/x");
		expect(g.sessionBranches.get("/s/det.jsonl")).toBe("abcdef12"); // detached → short HEAD
		expect(g.sessionBranches.has("/s/main.jsonl")).toBe(false);
	});

	it("the project is current when the active cwd is one of its worktrees", () => {
		const g = buildLeftNav([repo()], [], new Map(), "/home/.pi/worktrees/repo/feat-x")[0];
		expect(g.isCurrent).toBe(true);
		// the active checkout is listed unscoped; the other two must be fetched
		expect(g.fetchCwds).toEqual(["/repo", "/wt/detached"]);
		expect(pendingSessionCwds([g], new Set(), new Set(), new Set())).toEqual(["/repo", "/wt/detached"]);
	});

	it("a worktree cwd never forms an ungrouped group of its own", () => {
		const groups = buildLeftNav([repo()], [conv("x", "/wt/detached")], new Map(), "/elsewhere");
		expect(groups.map((g) => g.path)).toEqual(["/repo"]);
		expect(groups[0].fetchCwds).toEqual(["/repo", "/home/.pi/worktrees/repo/feat-x", "/wt/detached"]);
	});

	it("worktree paths fold case on Windows drives like any cwd", () => {
		const p: ProjectSummary = {
			path: "C:/Repo",
			lastUsed: 1,
			worktrees: [wt("C:/Repo", "main", true), wt("C:/Users/me/.pi/worktrees/Repo/feat", "feat")],
		};
		const g = buildLeftNav([p], [conv("k", "c:/users/me/.pi/worktrees/repo/feat")], new Map(), "C:/Repo")[0];
		expect(g.conversations.map((r) => [r.c.id, r.branch])).toEqual([["k", "feat"]]);
	});
});
