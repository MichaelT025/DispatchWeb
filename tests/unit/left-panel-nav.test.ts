import { describe, expect, it } from "vitest";
import {
	basename,
	buildLeftNav,
	flattenConversations,
	pendingSessionCwds,
	type NavGroup,
} from "../../web/src/components/left-panel-nav.js";
import type { ConversationSummary, ProjectSummary, SessionSummary } from "../../web/src/types.js";

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

	it("当前项目优先，其余按 lastUsed 降序", () => {
		const groups = buildLeftNav([project("/old", 1), project("/new", 9), project("/mid", 5)], [], new Map(), "/mid");
		expect(groups.map((g) => g.path)).toEqual(["/mid", "/new", "/old"]);
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
