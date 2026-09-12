/**
 * Per-project saved-chat (history) listing over raw WebSocket — no LLM provider.
 *
 * Seeding: two session transcripts live in a flat PI_CODING_AGENT_SESSION_DIR
 * root, each carrying the project cwd in its header. The test verifies the new
 * scoped list_sessions seam:
 *   1. list_sessions without cwd still returns the ACTIVE project's history.
 *   2. list_sessions { cwd: B } returns B's history WITHOUT switching the
 *      active cwd / conversation (the chevron expand path).
 *   3. Replies are tagged with their queried cwd, so concurrent queries for
 *      A and B never cross-attribute sessions (late replies land in the right
 *      project bucket).
 */
import { portUp } from "./lib/port-utils.mjs";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

// fileURLToPath: URL.pathname on Windows is /E:/... — using it as cwd directly fails.
const REPO_ROOT = fileURLToPath(new globalThis.URL("../", import.meta.url));

const PORT = 8914;
const A = mkdtempSync(join(tmpdir(), "pi-saved-a-"));
const B = mkdtempSync(join(tmpdir(), "pi-saved-b-"));
const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-saved-agent-"));
const SESSION_ROOT = mkdtempSync(join(tmpdir(), "pi-saved-sessions-"));
const DATA_DIR = mkdtempSync(join(tmpdir(), "pi-saved-data-"));
mkdirSync(SESSION_ROOT, { recursive: true });

// One saved transcript per project, written at the flat session-root top level.
function seedSession(file, cwd, userText, id) {
	const now = new Date().toISOString();
	writeFileSync(
		join(SESSION_ROOT, file),
		[
			JSON.stringify({ type: "session", version: 3, id, timestamp: now, cwd }),
			JSON.stringify({ type: "message", id: `${id}-u`, parentId: null, timestamp: now, message: { role: "user", content: userText } }),
			JSON.stringify({ type: "message", id: `${id}-a`, parentId: `${id}-u`, timestamp: now, message: { role: "assistant", content: "ok" } }),
			"",
		].join("\n"),
	);
}
seedSession("a.jsonl", A, "alpha saved chat", "sess-a");
seedSession("b.jsonl", B, "beta saved chat", "sess-b");

let failures = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
	if (!ok) failures++;
};

try {
	execSync("npm run build:server", { cwd: REPO_ROOT, stdio: "ignore" });
} catch {
	console.error("server build failed");
	process.exit(1);
}
const server = spawn("node", ["dist/server/index.js"], {
	cwd: REPO_ROOT,
	env: {
		...process.env,
		PI_WEB_PORT: String(PORT),
		PI_WEB_CWD: A,
		PI_WEB_DATA_DIR: DATA_DIR,
		PI_CODING_AGENT_DIR: AGENT_DIR,
		PI_CODING_AGENT_SESSION_DIR: SESSION_ROOT,
	},
	stdio: "ignore",
});
for (let i = 0; i < 40 && !(await portUp(PORT)); i++) await sleep(250);

const clientId = randomUUID();
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const send = (msg) => ws.send(JSON.stringify(msg));

let snapshot = null;
let bootConvId = null;
/** sessions messages keyed by the echoed cwd (the client-side map). */
const sessionsByCwd = new Map();
const readyDeferred = {};
readyDeferred.promise = new Promise((r) => (readyDeferred.resolve = r));

ws.on("message", (d) => {
	let m;
	try {
		m = JSON.parse(d.toString());
	} catch {
		return;
	}
	if (m.type === "snapshot") snapshot = m.state;
	else if (m.type === "sessions") sessionsByCwd.set(m.cwd ?? snapshot?.cwd ?? "", m.sessions);
	else if (m.type === "ready") readyDeferred.resolve();
});

const waitFor = async (pred, what, timeout = 8000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < timeout) {
		if (pred()) return true;
		await sleep(100);
	}
	console.error(`TIMEOUT waiting for ${what}`);
	return false;
};

ws.on("open", () => ws.send(JSON.stringify({ type: "hello", clientId })));
await readyDeferred.promise;
await waitFor(() => snapshot !== null, "initial snapshot");
bootConvId = snapshot.conversationId;

// 1. Unscoped list_sessions = active project (A), backward-compatible.
send({ type: "list_sessions" });
check("list_sessions (no cwd) returns active project A's history", await waitFor(() => sessionsByCwd.get(A)?.length === 1));
const aList = sessionsByCwd.get(A) ?? [];
check("A's history contains the alpha transcript only", aList.some((s) => s.firstMessage === "alpha saved chat") && !aList.some((s) => s.firstMessage === "beta saved chat"));

// 2. Scoped query for B must NOT switch the active conversation / cwd.
send({ type: "list_sessions", cwd: B });
check("list_sessions {cwd: B} returns B's history", await waitFor(() => sessionsByCwd.get(B)?.length === 1));
const bList = sessionsByCwd.get(B) ?? [];
check("B's history contains the beta transcript only", bList.some((s) => s.firstMessage === "beta saved chat") && !bList.some((s) => s.firstMessage === "alpha saved chat"));
check("active cwd unchanged after scoped query", snapshot?.cwd === A, snapshot?.cwd);
check("active conversation unchanged after scoped query", snapshot?.conversationId === bootConvId);

// 3. Concurrent queries: replies are tagged, so late arrivals cannot cross-attach.
sessionsByCwd.clear();
send({ type: "list_sessions", cwd: A });
send({ type: "list_sessions", cwd: B });
check("concurrent A + B replies both tagged", await waitFor(() => sessionsByCwd.has(A) && sessionsByCwd.has(B)));
const concA = sessionsByCwd.get(A) ?? [];
const concB = sessionsByCwd.get(B) ?? [];
check("concurrent reply A has no beta session", concA.some((s) => s.firstMessage === "alpha saved chat") && !concA.some((s) => s.firstMessage === "beta saved chat"));
check("concurrent reply B has no alpha session", concB.some((s) => s.firstMessage === "beta saved chat") && !concB.some((s) => s.firstMessage === "alpha saved chat"));
check("active cwd still A after concurrent queries", snapshot?.cwd === A);

ws.close();
server.kill();
if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log("saved-chats-per-project: all checks passed");
process.exit(0);
