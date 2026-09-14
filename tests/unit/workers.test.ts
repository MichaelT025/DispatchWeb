import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentMessage } from "../../server/serialize.js";
import { isAllowedTranscriptPath, isBridgeEvent, parseTranscriptJsonl, WorkerHub } from "../../server/workers.js";

const user = (text: string, ts = 1): AgentMessage => ({ role: "user", content: text, timestamp: ts }) as AgentMessage;
const assistant = (text: string, ts = 2): AgentMessage =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: ts,
		api: "x",
		provider: "p",
		model: "m",
		usage: {},
		stopReason: "stop",
	}) as unknown as AgentMessage;

function summary(id: number, over: Record<string, unknown> = {}) {
	return {
		id,
		toolCallId: "call-1",
		role: "general",
		model: "p/m",
		task: `task ${id}`,
		status: "running",
		activity: "Thinking…",
		started: 1000,
		recent: ["→ read a.ts"],
		text: "",
		...over,
	};
}

describe("isBridgeEvent", () => {
	it("accepts only version-1 workers/transcript events", () => {
		expect(isBridgeEvent({ version: 1, type: "workers", workers: [] })).toBe(true);
		expect(isBridgeEvent({ version: 1, type: "transcript", workerId: 1, messages: [], streaming: null })).toBe(true);
		expect(isBridgeEvent({ version: 2, type: "workers", workers: [] })).toBe(false);
		expect(isBridgeEvent({ version: 1, type: "discover" })).toBe(false);
		expect(isBridgeEvent({ version: 1, type: "workers" })).toBe(false);
		expect(isBridgeEvent(null)).toBe(false);
	});
});

describe("isAllowedTranscriptPath", () => {
	const agentDir = path.resolve("/agent");
	it("allows .jsonl files under <agentDir>/piastra/runs only", () => {
		expect(isAllowedTranscriptPath(path.join(agentDir, "piastra", "runs", "a.jsonl"), agentDir)).toBe(true);
		expect(isAllowedTranscriptPath(path.join(agentDir, "piastra", "runs", "x", "a.jsonl"), agentDir)).toBe(true);
		expect(isAllowedTranscriptPath(path.join(agentDir, "piastra", "runs", "..", "auth.json"), agentDir)).toBe(false);
		expect(isAllowedTranscriptPath(path.join(agentDir, "piastra", "runs"), agentDir)).toBe(false);
		expect(isAllowedTranscriptPath(path.join(agentDir, "sessions", "a.jsonl"), agentDir)).toBe(false);
		expect(isAllowedTranscriptPath(path.join(agentDir, "piastra", "runs", "a.txt"), agentDir)).toBe(false);
	});
});

describe("parseTranscriptJsonl", () => {
	it("keeps message entries and skips noise and a torn trailing line", () => {
		const text = [
			JSON.stringify({ type: "session", id: "s" }),
			JSON.stringify({ type: "message", message: user("hi") }),
			"not json",
			JSON.stringify({ type: "message", message: assistant("yo") }),
			'{"type":"message","message":{"role":"assis',
		].join("\n");
		const out = parseTranscriptJsonl(text);
		expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
	});
});

describe("WorkerHub", () => {
	let dir: string;
	let agentDir: string;
	beforeAll(() => {
		dir = mkdtempSync(path.join(tmpdir(), "pi-workers-"));
		agentDir = path.join(dir, "agent");
		mkdirSync(path.join(agentDir, "piastra", "runs"), { recursive: true });
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("lists workers in id order and reports changes only", () => {
		const hub = new WorkerHub(agentDir);
		expect(hub.applyList([summary(2), summary(1)])).toBe(true);
		expect(hub.list().map((w) => w.id)).toEqual([1, 2]);
		expect(hub.list()[0]).toMatchObject({ status: "running", hasTranscript: false, toolCallId: "call-1" });
		expect(hub.applyList([summary(2), summary(1)])).toBe(false);
		expect(hub.applyList([summary(2), summary(1, { status: "completed", ended: 2000 })])).toBe(true);
		expect(hub.list()[0]).toMatchObject({ status: "completed", ended: 2000 });
		// unknown status / junk fields are coerced, not trusted
		hub.applyList([summary(1, { status: "weird", recent: [1, "ok"], text: 5 })]);
		expect(hub.list()[0]).toMatchObject({ status: "starting", recent: ["ok"], text: "" });
		expect(hub.list()).toHaveLength(1);
	});

	it("drops followers of workers the extension no longer reports", () => {
		const hub = new WorkerHub(agentDir);
		hub.applyList([summary(1), summary(2)]);
		hub.open.add(2);
		expect(hub.applyList([summary(1)])).toBe(true);
		expect(hub.open.has(2)).toBe(false);
		expect(hub.has(2)).toBe(false);
	});

	it("serves live transcripts with stable message ids and a streaming tail", async () => {
		const hub = new WorkerHub(agentDir);
		hub.applyList([summary(1)]);
		expect(hub.applyTranscript(9, [], null)).toBe(false);
		expect(hub.applyTranscript(1, [user("hi")], assistant("partial"))).toBe(true);
		expect(hub.list()[0].hasTranscript).toBe(true);
		const first = await hub.transcript(1);
		expect(first.source).toBe("live");
		expect(first.messages).toHaveLength(1);
		expect(first.streamingMessage?.id).toBe("stream-2");
		hub.applyTranscript(1, [user("hi"), assistant("done")], null);
		const second = await hub.transcript(1);
		expect(second.messages[0]).toBe(first.messages[0]);
		expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(second.streamingMessage).toBeNull();
	});

	it("reads a saved transcript from the run directory and refuses others", async () => {
		const file = path.join(agentDir, "piastra", "runs", "run.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({ type: "message", message: user("saved") }),
				JSON.stringify({ type: "message", message: assistant("ok") }),
			].join("\n"),
		);
		const hub = new WorkerHub(agentDir);
		hub.applyList([summary(1, { status: "running", transcript: file })]);
		expect(hub.list()[0].hasTranscript).toBe(true);
		const running = await hub.transcript(1);
		expect(running.source).toBe("file");
		expect(running.messages).toHaveLength(2);
		// still running: re-read on every request (the file grows)
		writeFileSync(file, `${JSON.stringify({ type: "message", message: user("saved") })}\n`);
		expect((await hub.transcript(1)).messages).toHaveLength(1);
		// finished: parsed once and cached
		hub.applyList([summary(1, { status: "completed", transcript: file })]);
		expect((await hub.transcript(1)).messages).toHaveLength(1);
		writeFileSync(file, "");
		expect((await hub.transcript(1)).messages).toHaveLength(1);

		const outside = path.join(dir, "outside.jsonl");
		writeFileSync(outside, JSON.stringify({ type: "message", message: user("nope") }));
		hub.applyList([summary(2, { transcript: outside })]);
		expect(await hub.transcript(2)).toEqual({ workerId: 2, messages: [], streamingMessage: null, source: "none" });
		expect(await hub.transcript(3)).toMatchObject({ source: "none" });
	});
});
