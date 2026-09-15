import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../server/serialize.js";
import {
	buildPreviewState,
	contentFingerprint,
	newSerializeCache,
	serializeCachedInto,
	serializeTranscript,
	UI_MESSAGE_CACHE_CAP,
	type PreviewStateInput,
} from "../../server/session-preview.js";

function user(ts: number, text: string): AgentMessage {
	return { role: "user", timestamp: ts, content: [{ type: "text", text }] } as unknown as AgentMessage;
}

function assistant(ts: number, text: string, stopReason: string = "stop"): AgentMessage {
	return {
		role: "assistant",
		timestamp: ts,
		content: [{ type: "text", text }],
		model: "m",
		provider: "p",
		stopReason,
	} as unknown as AgentMessage;
}

function toolResult(id: string, ts: number, text: string): AgentMessage {
	return {
		role: "toolResult",
		timestamp: ts,
		toolCallId: id,
		toolName: "bash",
		isError: false,
		content: [{ type: "text", text }],
	} as unknown as AgentMessage;
}

function hiddenCustom(ts: number): AgentMessage {
	return {
		role: "custom",
		timestamp: ts,
		customType: "x",
		display: false,
		content: [{ type: "text", text: "hidden" }],
	} as unknown as AgentMessage;
}

describe("serializeCachedInto", () => {
	it("同一条消息重复序列化返回同一对象（引用稳定）", () => {
		const cache = newSerializeCache();
		const m = user(1000, "hi");
		const a = serializeCachedInto(cache, m);
		const b = serializeCachedInto(cache, m);
		expect(a).not.toBeNull();
		expect(b).toBe(a);
	});

	it("user 消息 id 后缀按同一时间戳内的 1-based 序号计数，其它角色用全局计数", () => {
		const cache = newSerializeCache();
		const ids = [
			serializeCachedInto(cache, user(5, "first")),
			serializeCachedInto(cache, user(5, "second")),
			serializeCachedInto(cache, assistant(6, "ans")),
			serializeCachedInto(cache, user(7, "third")),
		].map((m) => m?.id);
		// Two user messages in the same millisecond → seq 1 and 2; the assistant
		// takes the global counter (3); the next user timestamp starts at 1 again.
		expect(ids).toEqual(["u-5-1", "u-5-2", "a-6-3", "u-7-1"]);
	});

	it("toolResult 按 toolCallId 建键（时间戳无关）", () => {
		const cache = newSerializeCache();
		const a = serializeCachedInto(cache, toolResult("call-1", 10, "out"));
		const b = serializeCachedInto(cache, toolResult("call-1", 99, "out"));
		expect(a?.id).toBe("t-call-1");
		expect(b).toBe(a);
	});

	it("display:false 的 custom 消息返回 null 且不进缓存", () => {
		const cache = newSerializeCache();
		expect(serializeCachedInto(cache, hiddenCustom(1))).toBeNull();
		expect(cache.uiMessageCache.size).toBe(0);
	});

	it("缓存超过上限时淘汰最旧的条目", () => {
		const cache = newSerializeCache();
		for (let i = 0; i < UI_MESSAGE_CACHE_CAP + 5; i++) serializeCachedInto(cache, assistant(i, `m${i}`));
		expect(cache.uiMessageCache.size).toBe(UI_MESSAGE_CACHE_CAP);
		// Oldest evicted, newest kept.
		expect([...cache.uiMessageCache.keys()][0]).toContain("assistant:5:");
	});

	it("两个独立缓存对同一转录产生相同 id（预览与真实快照一致）", () => {
		const transcript = [user(1, "q"), assistant(2, "a"), toolResult("c", 3, "o"), user(4, "q2")];
		const a = serializeTranscript(newSerializeCache(), transcript);
		const b = serializeTranscript(newSerializeCache(), transcript);
		expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
		expect(a).toEqual(b);
	});
});

describe("contentFingerprint", () => {
	it("同一毫秒内不同文本的消息指纹不同，同文本相同", () => {
		expect(contentFingerprint(user(1, "alpha"))).toBe(contentFingerprint(user(2, "alpha")));
		expect(contentFingerprint(user(1, "alpha"))).not.toBe(contentFingerprint(user(1, "beta")));
	});

	it("空内容与图片有各自的形态", () => {
		expect(contentFingerprint({ role: "user", content: [] } as unknown as AgentMessage)).toBe("empty");
		const img = { role: "user", content: [{ type: "image", data: "abcd" }] } as unknown as AgentMessage;
		expect(contentFingerprint(img)).toBe("img:4");
	});
});

describe("serializeTranscript", () => {
	it("保序、跳过隐藏消息、末尾 error 不剥离（预览无重试态）", () => {
		const cache = newSerializeCache();
		const out = serializeTranscript(cache, [user(1, "q"), hiddenCustom(2), assistant(3, "boom", "error")]);
		// The hidden message still consumes a global id slot (2) — the same
		// numbering a live conversation produces, which is what keeps preview
		// and real-snapshot ids identical.
		expect(out.map((m) => m.id)).toEqual(["u-1-1", "a-3-3"]);
		expect(out[1].stopReason).toBe("error");
	});

	it("空转录返回空数组", () => {
		expect(serializeTranscript(newSerializeCache(), [])).toEqual([]);
	});
});

describe("buildPreviewState", () => {
	const base: PreviewStateInput = {
		clientId: "client",
		cwd: "/work/proj",
		sessionId: "sess",
		sessionFile: "/agent/sessions/--work-proj--/x.jsonl",
		conversationId: "c7",
		rev: 42,
		version: 9,
		messages: serializeTranscript(newSerializeCache(), [user(1, "q"), assistant(2, "a")]),
		totalMessages: 2,
		model: { provider: "anthropic", modelId: "claude-x" },
		thinkingLevel: "medium",
		piConfigured: true,
		piAgentInstalled: false,
	};

	it("标记 booting、带上新对话 id / 会话文件 / 转录，运行时字段全为占位", () => {
		const st = buildPreviewState(base);
		expect(st.booting).toBe(true);
		expect(st.conversationId).toBe("c7");
		expect(st.cwd).toBe("/work/proj");
		expect(st.sessionFile).toBe(base.sessionFile);
		expect(st.sessionId).toBe("sess");
		expect(st.rev).toBe(42);
		expect(st.version).toBe(9);
		expect(st.messages).toBe(base.messages);
		expect(st.isStreaming).toBe(false);
		expect(st.streamingMessage).toBeNull();
		expect(st.queue).toEqual({ steering: [], followUp: [] });
		expect(st.tools).toEqual([]);
		expect(st.workers).toEqual([]);
		expect(st.availableThinkingLevels).toEqual([]);
		expect(st.retry).toBeNull();
		expect(st.compaction).toBeNull();
		expect(st.pendingQuestion).toBeNull();
		expect(st.piConfigured).toBe(true);
		expect(st.piAgentInstalled).toBe(false);
		expect(st.stats.totalMessages).toBe(2);
		expect(st.stats.tokens.total).toBe(0);
		expect(st.stats.contextUsage).toEqual({ tokens: null, contextWindow: 0, percent: null });
	});

	it("模型来自转录的 model 记录（name = 原始 id，vision 未知为 false）", () => {
		expect(buildPreviewState(base).model).toEqual({
			id: "claude-x",
			name: "claude-x",
			provider: "anthropic",
			vision: false,
		});
		expect(buildPreviewState({ ...base, model: null }).model).toBeNull();
	});

	it("thinkingLevel 透传", () => {
		expect(buildPreviewState(base).thinkingLevel).toBe("medium");
	});
});
