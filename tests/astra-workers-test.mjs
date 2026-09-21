/* Delegated workers — delegate card rows + right-workspace Workers pane (browser).
 *
 * Exercises the worker bridge end to end with test-owned fixtures only:
 *
 *   1. A saved session transcript (temp session root) holds one `delegate`
 *      tool call whose result carries the saved worker roster (details.workers,
 *      linked by toolCallId) — the restore path. Worker #1's own transcript is
 *      a JSONL file under <agentDir>/piastra/runs, the only directory the
 *      server may read worker transcripts from.
 *   2. A TEST-ONLY extension (temp agent dir) speaks PiAstra's public
 *      `piastra:workers` event protocol (version 1): it republishes the saved
 *      roster on session_start / discover, adds one synthetic LIVE worker whose
 *      in-memory transcript streams over `transcript` events, and honours a
 *      per-worker `cancel`. No model, provider or credential calls anywhere.
 *
 * Honest scope: this is a protocol + presentation test. The real extension's
 * delegate tool (worker sessions, models, abort) is covered by PiAstra's own
 * tests; what is proven here is that whatever it publishes on that channel
 * reaches the card and the pane over the genuine WS protocol.
 *
 * Run: npm run build && node tests/astra-workers-test.mjs
 */
import { repoRoot, startBrowserFixture, artifactDir, eventually } from "./lib/browser-fixture.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SHOT_DIR = artifactDir;

// --- isolated temp environment ------------------------------------------------
const base = mkdtempSync(join(tmpdir(), "piweb-workers-"));
const proj = join(base, "proj");
const agentDir = join(base, "agent");
const dataDir = join(base, "data");
const sessionRoot = join(base, "sessions");
const extDir = join(agentDir, "extensions");
const runsDir = join(agentDir, "piastra", "runs");
for (const d of [proj, agentDir, dataDir, sessionRoot, extDir, runsDir]) mkdirSync(d, { recursive: true });
writeFileSync(join(proj, "a.txt"), "alpha\n");

// Worker #1's saved transcript (what the real delegate tool writes per worker).
const w1File = join(runsDir, "w1.jsonl");
const jsonl = (entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
writeFileSync(
	w1File,
	jsonl([
		{ type: "session", version: 3, id: "w1", timestamp: new Date().toISOString(), cwd: proj },
		{
			type: "message",
			id: "w1-u",
			parentId: null,
			message: { role: "user", content: "Review the diff", timestamp: 10 },
		},
		{
			type: "message",
			id: "w1-a1",
			parentId: "w1-u",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "w1-read", name: "read", arguments: { path: "a.txt" } }],
				timestamp: 20,
				api: "x",
				provider: "p",
				model: "m",
				usage: {},
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "w1-t",
			parentId: "w1-a1",
			message: {
				role: "toolResult",
				toolCallId: "w1-read",
				toolName: "read",
				content: [{ type: "text", text: "alpha" }],
				isError: false,
				timestamp: 30,
			},
		},
		{
			type: "message",
			id: "w1-a2",
			parentId: "w1-t",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "SAVED WORKER RESULT: looks fine." }],
				timestamp: 40,
				api: "x",
				provider: "p",
				model: "m",
				usage: {},
				stopReason: "stop",
			},
		},
	]),
);

// The parent session: one delegate call with a saved roster of two workers.
const savedWorkers = [
	{
		id: 1,
		toolCallId: "call-1",
		role: "review",
		model: "p/review-model",
		task: "Review the diff against main",
		status: "completed",
		activity: "Finished",
		started: 1000,
		ended: 61_000,
		recent: ["→ read a.txt", "✓ read"],
		text: "looks fine",
		transcript: w1File,
	},
	{
		id: 2,
		toolCallId: "call-1",
		role: "general",
		model: "p/general-model",
		task: "Implement the change",
		status: "running",
		activity: "→ edit src/app.ts",
		started: 1000,
		recent: [],
		text: "",
	},
];
const now = new Date().toISOString();
writeFileSync(
	join(sessionRoot, "parent.jsonl"),
	jsonl([
		{ type: "session", version: 3, id: "sess-p", timestamp: now, cwd: proj },
		{
			type: "message",
			id: "p-u",
			parentId: null,
			timestamp: now,
			message: { role: "user", content: "delegate this work", timestamp: 100 },
		},
		{
			type: "message",
			id: "p-a",
			parentId: "p-u",
			timestamp: now,
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "delegate",
						arguments: {
							tasks: [
								{ role: "review", access: "read", task: "Review the diff against main" },
								{ role: "general", access: "write", task: "Implement the change" },
							],
						},
					},
				],
				timestamp: 200,
				api: "x",
				provider: "p",
				model: "m",
				usage: {},
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "p-t",
			parentId: "p-a",
			timestamp: now,
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "delegate",
				content: [{ type: "text", text: "review · completed\nlooks fine" }],
				details: { workers: savedWorkers },
				isError: false,
				timestamp: 300,
			},
		},
		{
			type: "message",
			id: "p-a2",
			parentId: "p-t",
			timestamp: now,
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Delegation finished." }],
				timestamp: 400,
				api: "x",
				provider: "p",
				model: "m",
				usage: {},
				stopReason: "stop",
			},
		},
	]),
);

// Test-only worker bridge mock: PiAstra's public channel, no model work.
writeFileSync(
	join(extDir, "piastra-workers-mock.js"),
	`// Test-only mock of PiAstra's worker bridge (extensions/piastra/worker-bridge.mjs).
// Same channel and event shapes; the only "worker" is an in-memory script.
const CHANNEL = "piastra:workers";
export default function (pi) {
	const workers = new Map();
	const live = new Map(); // id -> { messages, streaming }
	const emit = (data) => pi.events.emit(CHANNEL, { version: 1, ...data });
	const publish = () => emit({ type: "workers", workers: [...workers.values()].map((w) => ({ ...w })) });
	const transcript = (id) => {
		const t = live.get(id);
		if (t) emit({ type: "transcript", workerId: id, messages: t.messages, streaming: t.streaming });
	};
	const asst = (text, ts) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: ts, api: "x", provider: "p", model: "m", usage: {}, stopReason: "stop" });
	let timer = null;
	const restore = (_event, ctx) => {
		workers.clear(); live.clear();
		if (timer) { clearInterval(timer); timer = null; }
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message?.role !== "toolResult" || entry.message.toolName !== "delegate") continue;
			for (const saved of entry.message.details?.workers || []) {
				const w = { ...saved };
				if (["running", "starting"].includes(w.status)) { w.status = "interrupted"; w.activity = "This worker is no longer attached."; }
				workers.set(w.id, w);
			}
		}
		// A provider/model failure must have its own section, not count as Finished.
		workers.set(4, { id: 4, toolCallId: "call-failed", role: "fast", model: "p/unavailable-model", task: "Worker with provider error", status: "failed", activity: "Unavailable model; no fallback used.", started: 1000, ended: 2000, recent: [], text: "" });
		live.set(4, { messages: [asst("FAILED WORKER TRANSCRIPT", 2000)], streaming: null });
		// One synthetic LIVE worker: streams three assistant messages, then completes.
		const id = 3;
		workers.set(id, { id, toolCallId: "call-live", role: "fast", model: "p/fast-model", task: "Live synthetic worker", status: "running", activity: "Thinking…", started: Date.now(), recent: [], text: "" });
		live.set(id, { messages: [{ role: "user", content: "Live synthetic worker", timestamp: 1 }], streaming: null });
		let step = 0;
		timer = setInterval(() => {
			const w = workers.get(id);
			const t = live.get(id);
			if (!w || !t || w.status !== "running") { clearInterval(timer); timer = null; return; }
			step++;
			if (step <= 3) {
				t.streaming = asst("LIVE STEP " + step + " partial", 100 + step);
				w.activity = "Responding… step " + step;
				transcript(id); publish();
				t.messages = [...t.messages, asst("LIVE STEP " + step + " done", 100 + step)];
				t.streaming = null;
				transcript(id);
			} else if (step === 12) {
				w.status = "completed"; w.activity = "Finished"; w.ended = Date.now();
				publish(); transcript(id);
			}
		}, 300);
		publish();
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.on("session_shutdown", async () => { if (timer) clearInterval(timer); });
	pi.events.on(CHANNEL, (event) => {
		if (event?.version !== 1) return;
		if (event.type === "discover") publish();
		else if (event.type === "transcript_request") transcript(event.workerId);
		else if (event.type === "cancel") {
			const w = workers.get(event.workerId);
			if (w && w.status === "running") { w.status = "cancelled"; w.activity = "Cancelled by the user."; w.ended = Date.now(); publish(); transcript(event.workerId); }
		}
	});
}
`,
);

let failures = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
	if (!ok) failures++;
};
const until = async (name, predicate, timeout = 10000) => {
	try {
		await eventually(predicate, name, timeout);
		check(name, true);
	} catch (e) {
		check(name, false, String(e).split("\n")[0]);
	}
};

const previousPkgRoot = process.env.PI_WEB_PKG_ROOT;
process.env.PI_WEB_PKG_ROOT = repoRoot;
let fixture;
try {
	fixture = await startBrowserFixture({ cwd: proj, agentDir, dataDir, sessionRoot });
} finally {
	if (previousPkgRoot === undefined) delete process.env.PI_WEB_PKG_ROOT;
	else process.env.PI_WEB_PKG_ROOT = previousPkgRoot;
}
const browser = fixture.browser;
try {
	const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	let shotN = 0;
	const shot = (name) => page.screenshot({ path: join(SHOT_DIR, `astra-workers-${name}.png`) });

	await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
	await sleep(3000);
	if ((await page.locator(".modal-backdrop .modal-close").count()) > 0) {
		await page.locator(".modal-backdrop .modal-close").first().click();
		await sleep(500);
	}
	check("setup overlay dismissed (no credentials seeded)", (await page.locator(".modal-backdrop").count()) === 0);

	// ---------- 1) the fresh chat already lists the mock's live worker ----------
	await page.keyboard.press("Control+Shift+L");
	await until(
		"Ctrl+Shift+L opens the Workers pane",
		async () => (await page.locator(".workers-list, .workers-empty").count()) === 1,
	);
	await until(
		"live worker #3 listed under Active",
		async () => (await page.locator(".workers-section").first().locator(".worker-row").count()) === 1,
	);
	const activeRow = page.locator(".workers-section").first().locator(".worker-row").first();
	const activeDetails = await activeRow.evaluate((row) => ({
		task: row.querySelector(".worker-task")?.textContent?.trim(),
		statusLabel: row.querySelector(".worker-row-status")?.getAttribute("aria-label"),
		statusTitle: row.querySelector(".worker-row-status")?.getAttribute("title"),
		hasStatusIcon: row.querySelector(".worker-row-status svg") !== null,
		elapsed: row.querySelector(".worker-elapsed")?.textContent?.trim() ?? "",
		text: row.textContent ?? "",
		role: row.querySelector(".worker-role")?.textContent?.trim(),
		hasRoleIcon: row.querySelector(".worker-role svg") !== null,
		id: row.querySelector(".worker-id")?.textContent?.trim(),
		detail: row.querySelector(".worker-row-detail.live")?.textContent?.trim(),
		hasModel: row.querySelector(".worker-model") !== null,
	}));
	check(
		"Active row has compact task, status tooltip/icon and elapsed time",
		activeDetails.task === "Live synthetic worker" &&
			activeDetails.statusLabel === "Running" &&
			activeDetails.statusTitle === "Running" &&
			activeDetails.hasStatusIcon &&
			/^\d+(?:s|m \d{2}s|h \d{2}m)$/.test(activeDetails.elapsed),
	);
	check(
		"Active row names the agent (role icon + role + id) and shows its live activity, not the model",
		activeDetails.role === "fast" &&
			activeDetails.hasRoleIcon &&
			activeDetails.id === "#3" &&
			typeof activeDetails.detail === "string" &&
			activeDetails.detail.length > 0 &&
			!activeDetails.hasModel,
	);
	check(
		"Workers tab shows the running count badge",
		(await page.locator(".astra-workspace-badge").innerText()) === "1",
	);
	await shot(`${String(++shotN).padStart(2, "0")}-active-list`);

	// ---------- 2) open the saved session: delegate card rows from the roster ----------
	await page.locator(".session-item", { hasText: "delegate this work" }).first().click();
	await until("saved session loads with a delegate card", async () => (await page.locator(".toolcall").count()) >= 1);
	check(
		"collapsed summary counts workers per role",
		/Delegated to\s+review \+ general/.test(
			(await page.locator(".toolcall-summary").first().innerText()).replace(/\s+/g, " "),
		),
	);
	await page.locator(".toolcall-head").first().click();
	await until("card body lists both saved workers", async () => (await page.locator(".delegate-worker").count()) === 2);
	check(
		"unfinished saved worker is shown as interrupted",
		(await page.locator(".delegate-worker").nth(1).locator(".worker-status").innerText()) === "Interrupted",
	);
	check("card hides the raw progress dump", (await page.locator(".toolcall-output").count()) === 0);
	await shot(`${String(++shotN).padStart(2, "0")}-delegate-card`);

	// ---------- 3) a card row opens that worker's saved transcript in the pane ----------
	await page.locator(".delegate-worker").first().click();
	await until(
		"pane switches to worker #1 detail",
		async () =>
			(await page.locator(".worker-detail .worker-id").count()) === 1 &&
			(await page.locator(".worker-detail .worker-id").innerText()) === "#1",
	);
	await until(
		"saved transcript (JSONL under piastra/runs) renders with the chat components",
		async () =>
			(await page.locator(".worker-transcript .msg").count()) >= 2 &&
			(await page.locator(".worker-transcript").innerText()).includes("SAVED WORKER RESULT"),
	);
	check(
		"saved worker's tool call renders as a tool card",
		(await page.locator(".worker-transcript .toolcall").count()) === 1,
	);
	check("finished worker has no Stop button", (await page.locator(".worker-cancel").count()) === 0);
	await shot(`${String(++shotN).padStart(2, "0")}-saved-transcript`);

	// ---------- 4) back to the lists: Active / Done ----------
	await page.locator(".worker-back").click();
	await until("lists show 1 active + 2 done", async () => {
		const sections = page.locator(".workers-section");
		return (
			(await sections.nth(0).locator(".worker-row").count()) === 1 &&
			(await sections.nth(1).locator(".worker-row").count()) === 2 &&
			(await sections.nth(1).evaluate((element) => element.tagName === "DETAILS" && element.open))
		);
	});
	const doneSection = page.locator(".workers-section").nth(1);
	check(
		"Done is open initially and collapsible",
		(await doneSection.getAttribute("open")) !== null &&
			(await doneSection.locator(".worker-row:visible").count()) === 2,
	);
	await doneSection.locator("summary").click();
	await until("Done collapses on click", async () => (await doneSection.locator(".worker-row:visible").count()) === 0);
	await doneSection.locator("summary").click();
	await until(
		"Done re-expands to show both workers",
		async () => (await doneSection.locator(".worker-row:visible").count()) === 2,
	);
	check(
		"Done is newest first by task",
		(await doneSection.locator(".worker-task").allInnerTexts()).join("|") ===
			"Implement the change|Review the diff against main",
	);

	// ---------- 5) live worker: streaming transcript, then Stop ----------
	await page.locator(".workers-section").first().locator(".worker-row").click();
	await until(
		"live worker detail opens",
		async () => (await page.locator(".worker-detail .worker-id").innerText()) === "#3",
	);
	await until(
		"live transcript streams in over transcript events",
		async () => (await page.locator(".worker-transcript").innerText()).includes("LIVE STEP 3 done"),
		8000,
	);
	check("streaming worker shows a Stop button", (await page.locator(".worker-cancel").count()) === 1);
	await shot(`${String(++shotN).padStart(2, "0")}-live-transcript`);
	await page.locator(".worker-cancel").click();
	await until(
		"Stop cancels only that worker via the bridge",
		async () => (await page.locator(".worker-detail .worker-status").innerText()) === "Cancelled",
	);
	check("Stop button disappears once cancelled", (await page.locator(".worker-cancel").count()) === 0);
	check(
		"footer carries the extension's activity line",
		(await page.locator(".worker-detail-foot").innerText()).includes("Cancelled by the user"),
	);
	await page.locator(".worker-back").click();
	await until(
		"cancelled worker moves to Done",
		async () => (await page.locator(".workers-section").nth(1).locator(".worker-row").count()) === 3,
	);
	check("badge disappears when nothing runs", (await page.locator(".astra-workspace-badge").count()) === 0);
	await shot(`${String(++shotN).padStart(2, "0")}-done-list`);

	const failedSection = page.locator('.workers-section[aria-labelledby="workers-failed-heading"]');
	check(
		"three worker sections are ordered Running, Finished, Failed",
		(
			await page
				.locator(".workers-section")
				.evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-labelledby")))
		).join("|") === "workers-active-heading|workers-done-heading|workers-failed-heading",
	);
	check(
		"provider errors are exclusively in Failed",
		(await failedSection.locator(".worker-id").allInnerTexts()).join() === "#4" &&
			!(await doneSection.innerText()).includes("Worker with provider error"),
	);
	await failedSection.locator("summary").click();
	check("Failed is independently collapsible", (await failedSection.locator(".worker-row:visible").count()) === 0);
	await failedSection.locator("summary").click();
	await shot(`${String(++shotN).padStart(2, "0")}-failed-list`);
	await failedSection.locator(".worker-row").click();
	await until("failed worker transcript still opens", async () =>
		(await page.locator(".worker-transcript").innerText()).includes("FAILED WORKER TRANSCRIPT"),
	);
	check(
		"failed worker preserves reason and has no Stop action",
		(await page.locator(".worker-detail-foot").innerText()).includes("Unavailable model") &&
			(await page.locator(".worker-cancel").count()) === 0,
	);

	check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await fixture.close();
}
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
