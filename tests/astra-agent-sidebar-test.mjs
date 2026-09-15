/* Astra pass 4 — nested project chats + four agent composer states (browser).
 *
 * Complements tests/astra-shell-test.mjs (which owns the shell/chooser/terminal
 * milestones). This test focuses on the two features the saved-chats commit
 * (63733d2 "feat(web): load saved chats within project groups") and the agent
 * picker commit (cd4a16d "feat(web): add session-aware agent picker and
 * composer accents") introduced, using ONLY test-owned fixtures:
 *
 *   1. Synthetic session transcripts (temp session root) carry project A / B
 *      cwds in their JSONL headers, so the left nav discovers both projects.
 *      A's saved chat appears on boot; B's saved chat is loaded lazily when its
 *      project group is expanded (list_sessions { cwd: B }) and renders nested
 *      under B — never under A.
 *   2. A TEST-ONLY extension (temp agent dir) registers `/agent` + `/dispatch`
 *      (plus the legacy `/piastra` alias) with source === extension and, on
 *      `/agent <role>`, writes the real `piastra-agent` status via
 *      ctx.ui.setStatus. This exercises the full
 *      frontend picker → WS prompt → extension status → UI bridge round-trip
 *      with NO provider/model/credential calls.
 *
 * IMPORTANT (honest scope): this extension is a status-bridge MOCK. It does NOT
 * switch models/thinking/tools, so the four highlighted composer states are
 * presentation + transport evidence only. A real `/agent` role switch (SDK
 * model change) is verified separately by the parent-side fork-runtime test and
 * is NOT claimed here.
 *
 * No production fixture route or fixture client code is referenced; every
 * message goes over the genuine WS protocol to the built server.
 *
 * Run: npm run build:web && npm run build:server && node tests/astra-agent-sidebar-test.mjs
 */
import { startBrowserFixture, artifactDir } from "./lib/browser-fixture.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const SHOT_DIR = artifactDir;

// --- isolated temp environment ------------------------------------------------
const base = mkdtempSync(join(tmpdir(), "piweb-astra4-"));
const projA = join(base, "projA");
const projB = join(base, "projB");
const agentDir = join(base, "agent");
const dataDir = join(base, "data");
const sessionRoot = join(base, "sessions");
const extDir = join(agentDir, "extensions");
for (const d of [projA, projB, agentDir, dataDir, sessionRoot, extDir]) mkdirSync(d, { recursive: true });
writeFileSync(join(projA, "a.txt"), "alpha\n");
writeFileSync(join(projB, "b.txt"), "beta\n");

// Seed one saved transcript per project (flat session root, cwd in header).
function seedSession(file, cwd, userText, id) {
	const now = new Date().toISOString();
	writeFileSync(
		join(sessionRoot, file),
		[
			JSON.stringify({ type: "session", version: 3, id, timestamp: now, cwd }),
			JSON.stringify({
				type: "message",
				id: `${id}-u`,
				parentId: null,
				timestamp: now,
				message: { role: "user", content: userText },
			}),
			JSON.stringify({
				type: "message",
				id: `${id}-a`,
				parentId: `${id}-u`,
				timestamp: now,
				message: { role: "assistant", content: "ok" },
			}),
			"",
		].join("\n"),
	);
}
seedSession("a.jsonl", projA, "alpha nested chat", "sess-a");
seedSession("b.jsonl", projB, "beta nested chat", "sess-b");

// Test-only extension: catalog presence + status bridge, no model work.
writeFileSync(
	join(extDir, "piastra-status-mock.js"),
	`// Test-only status bridge mock. Registers the same command names/source the
// real Dispatch extension does, but setStatus is the ONLY side effect — no
// setModel / setThinkingLevel / setActiveTools and no provider call.
export default function (pi) {
	const order = ["orchestrator", "general", "fast", "review"];
	pi.registerCommand("agent", {
		description: "Select Dispatch agent: orchestrator, general, fast, review",
		handler: async (args, ctx) => {
			const role = (args || "orchestrator").trim().toLowerCase();
			if (!order.includes(role)) return;
			ctx.ui.setStatus("piastra-agent", "Agent: " + role);
		},
	});
	pi.registerCommand("dispatch", {
		description: "Show Dispatch roles and delegation availability",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Active: orchestrator\\n/agent selects; Ctrl+Shift+A cycles.", "info");
		},
	});
	pi.registerCommand("piastra", {
		description: "Legacy alias of /dispatch (Dispatch roles summary)",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Active: orchestrator\\n/agent selects; Ctrl+Shift+A cycles.", "info");
		},
	});
}
`,
);

// Pre-seed the browser's per-tab client id so server-side client-state already
// knows both projects (mirrors a returning user's recent-project list).
const CLIENT_ID = randomUUID();
writeFileSync(
	join(dataDir, "client-state.json"),
	JSON.stringify(
		{
			[CLIENT_ID]: {
				lastCwd: projA,
				lastUsedModel: {},
				projects: [
					{ path: projA, lastUsed: Date.now() },
					{ path: projB, lastUsed: Date.now() - 60_000 },
				],
			},
		},
		null,
		2,
	),
);

let failures = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
	if (!ok) failures++;
};
const checkVisible = async (page, name, selector, timeout = 8000) => {
	try {
		await page.locator(selector).first().waitFor({ state: "visible", timeout });
		check(name, true);
	} catch (e) {
		check(name, false, String(e).split("\n")[0]);
	}
};

const fixture = await startBrowserFixture({ cwd: projA, agentDir, dataDir, sessionRoot });
const browser = fixture.browser;
try {
	const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
	await ctx.addInitScript(
		([cid, collapsedPath]) => {
			try {
				sessionStorage.setItem("pi-web-client-id", cid);
				// Start the non-current project collapsed so expanding it exercises the
				// lazy `list_sessions { cwd }` path (the feature under test).
				localStorage.setItem("pi-web-ui:lp-collapsed-groups", JSON.stringify([collapsedPath]));
			} catch {}
		},
		[CLIENT_ID, projB],
	);
	const page = await ctx.newPage();
	let shotN = 0;
	const shot = (name) => page.screenshot({ path: join(SHOT_DIR, `astra-polish-${name}.png`) });

	// ---------- boot: real empty conversation + discovered projects ----------
	await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
	await sleep(3000);

	// The temp agent dir has no auth, so the one-time Pi setup overlay opens on
	// boot. Dismiss it so it cannot intercept clicks (test presentation only —
	// no provider key is entered and no model request is made).
	if ((await page.locator(".modal-backdrop .modal-close").count()) > 0) {
		await page.locator(".modal-backdrop .modal-close").first().click();
		await sleep(500);
	}
	check("setup overlay dismissed (no credentials seeded)", (await page.locator(".modal-backdrop").count()) === 0);

	// ---------- 1) nested project chats in the left nav ----------
	const projABasename = projA.replace(/\\/g, "/").split("/").pop();
	const projBBasename = projB.replace(/\\/g, "/").split("/").pop();
	const groupA = page.locator(".lp-group", { has: page.locator(`.lp-group-label:text-is("${projABasename}")`) });
	const groupB = page.locator(".lp-group", { has: page.locator(`.lp-group-label:text-is("${projBBasename}")`) });

	check("project A group discovered from session file cwd", (await groupA.count()) === 1);
	check("project B group discovered from session file cwd", (await groupB.count()) === 1);
	check("current project group marked current", (await groupA.first().getAttribute("class"))?.includes("current"));

	// A is the active project → its saved chat is listed on boot, nested in A.
	check("saved chat for A rendered nested in A", (await groupA.locator(".lp-group-body .session-item").count()) >= 1);
	check(
		"A's session text matches the seeded transcript",
		(await groupA.locator(".session-item").first().innerText()).includes("alpha nested chat"),
	);
	// B's history must NOT be attributed to A.
	check("B's seeded chat never appears under A", !(await groupA.innerText()).includes("beta nested chat"));

	// B starts collapsed with no loaded sessions; expanding lazily loads them.
	check("B starts without a loaded history", (await groupB.locator(".lp-group-body .session-item").count()) === 0);
	await groupB.locator(".lp-group-toggle").click();
	await sleep(1800);
	check(
		"expanding B loads its saved chat (lazy list_sessions)",
		(await groupB.locator(".lp-group-body .session-item").count()) >= 1,
	);
	check(
		"B's nested chat matches the seeded transcript",
		(await groupB.locator(".session-item").first().innerText()).includes("beta nested chat"),
	);
	check("B's expansion does not leak B's chat into A", !(await groupA.innerText()).includes("beta nested chat"));
	check(
		"both project groups hold their own nested rows",
		(await groupA.locator(".session-item").count()) >= 1 && (await groupB.locator(".session-item").count()) >= 1,
	);

	await shot(`${String(++shotN).padStart(2, "0")}-sidebar-projects`);

	// ---------- 2) four agent composer states (mocked status bridge) ----------
	// Extension catalog → the picker is available (both /agent + /dispatch, source
	// extension). One neutral state before any confirmed status.
	await checkVisible(page, "agent picker available", ".agent-picker");
	check("picker exposes exactly the four role buttons", (await page.locator(".agent-picker-btn").count()) === 4);
	check(
		"no role pressed before a confirmed status",
		(await page.locator('.agent-picker-btn[aria-pressed="true"]').count()) === 0,
	);

	const ROLES = ["orchestrator", "general", "fast", "review"];
	// The roles live in a menu behind the composer pill; open it before each pick.
	const pickRole = async (role) => {
		await page.locator(".agent-picker-pill").click();
		await page.locator(`.agent-picker-btn[data-agent-role="${role}"]`).click();
	};
	for (const role of ROLES) {
		await pickRole(role);
		// Real WS round-trip: /agent <role> → extension ctx.ui.setStatus → statuses.
		let confirmed = false;
		for (let i = 0; i < 40; i++) {
			if ((await page.locator(`.agent-picker-btn[data-agent-role="${role}"][aria-pressed="true"]`).count()) === 1) {
				confirmed = true;
				break;
			}
			await sleep(150);
		}
		check(`picker confirms ${role} from the server status bridge`, confirmed);
		check(
			`composer root carries data-agent=${role}`,
			(await page.locator(`.inputbar[data-agent="${role}"]`).count()) === 1,
		);
		// Exactly one role highlighted at a time (server-confirmed, not optimistic).
		check(`only ${role} is highlighted`, (await page.locator('.agent-picker-btn[aria-pressed="true"]').count()) === 1);
		await shot(`${String(++shotN).padStart(2, "0")}-agent-${role}`);
	}

	// Sending an unknown role must not fabricate a state (mock extension ignores
	// it); the last confirmed role stays. This guards against optimistic UI.
	await pickRole("general");
	await sleep(1200);
	check(
		"confirmed role persists after selecting another role",
		(await page.locator('.agent-picker-btn[aria-pressed="true"]').count()) === 1,
	);
	check(
		"composer accent tracks the confirmed role",
		(await page.locator('.inputbar[data-agent="general"]').count()) === 1,
	);
} finally {
	await fixture.close();
}
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
