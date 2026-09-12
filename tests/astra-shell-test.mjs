/* Astra shell visual-milestone E2E (pass 2): charcoal left nav with brand +
 * New chat, compact header (theme/language/sound in overflow), calm empty
 * state (no template grid, no quick chips), centered workspace chooser,
 * ~half-width right pane, inline file preview with a way back, compact
 * terminal tab strip.
 * All checks run against the REAL empty state / locally-created conversations
 * — no fixture route and no provider calls.
 * Run: npm run build:web && node tests/astra-shell-test.mjs
 */
import { CHROME_PATH } from "./lib/chrome.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOT_DIR = fileURLToPath(new URL("../../PiAstra/docs/reference/", import.meta.url));
const PORT = 42000 + Math.floor(Math.random() * 2000);
const base = mkdtempSync(join(tmpdir(), "piweb-astra2-"));
const workdir = join(base, "work");
const dataDir = join(base, "data");
mkdirSync(workdir, { recursive: true });
writeFileSync(join(workdir, "readme.md"), "# Astra sample file\nsome *markdown* body\n");

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

const server = spawn("node", ["dist/server/index.js"], {
	cwd: REPO_ROOT,
	env: { ...process.env, PI_WEB_PORT: String(PORT), PI_WEB_CWD: workdir, PI_WEB_DATA_DIR: dataDir },
	stdio: "ignore",
});
for (let i = 0; i < 80; i++) {
	try {
		const r = await fetch(`http://localhost:${PORT}/api/health`);
		if (r.ok) break;
	} catch {}
	await sleep(250);
}

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: join(SHOT_DIR, name) });

// ---------- 1) empty state (no fixture) ----------
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
await sleep(2500);

check("compact astra header", (await page.locator(".astra-header").count()) === 1);
check("no upstream view-switch tab bar", (await page.locator(".view-switch").count()) === 0);
check("input bar preserved", (await page.locator(".inputbar").count()) >= 1);

// calm empty state: template grid + quick chip strip removed from primary chat
check("no template card grid", (await page.locator(".empty-templates").count()) === 0);
check("no quick prompt chip strip", (await page.locator(".quick-row").count()) === 0);
checkVisible(page, "calm empty state shown", ".astra-empty");
checkVisible(page, "empty state brand mark", ".astra-empty-mark");

// header: theme/language/sound no longer permanent
const headerSubs = await page.locator(".astra-header-right .chip-sub").count();
const directChips = await page.locator(".astra-header-right > button.chip").count();
check("no permanent theme/language labels in header", headerSubs === 0, `chip-sub count=${headerSubs}`);
check("header keeps search/bg/settings/terminal/workspace chips", directChips === 5, `direct chips=${directChips}`);
await page.locator(".astra-header-right .dropdown .chip").first().click();
await sleep(400);
const menuText = await page.locator(".dd-menu").innerText().catch(() => "");
check(
	"overflow holds theme + language + sound",
	/theme|主题/i.test(menuText) && /language|语言/i.test(menuText) && /sound|声音/i.test(menuText),
	menuText.slice(0, 60).replace(/\n/g, " | "),
);
await page.keyboard.press("Escape");
await sleep(300);

// left nav: brand + prominent New chat
checkVisible(page, "left nav visible", ".drawer-left .panel");
check("PiAstra brand in left nav", (await page.locator(".lp-brand-name").count()) === 1);
checkVisible(page, "prominent New chat button", ".lp-new-chat");
await shot("astra-05-empty.png");

// New chat resets the shell to a fresh, real (server-backed) state. It does
// not run a provider turn: assert the composer + calm empty state survive the
// reset, with no fixture route involved.
await page.locator(".lp-new-chat").click();
await sleep(1500);
check("New chat keeps the composer usable", (await page.locator(".inputbar").count()) >= 1);
checkVisible(page, "New chat returns to the calm empty state", ".astra-empty");

// ---------- 2) real conversation shell (no fixture, no provider calls) ----------
// The New chat click above created a real local conversation; reload to prove
// the shell renders it from actual server state (never a ?fixture route).
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
await sleep(2500);
check("no fixture route registered in the shell", (await page.locator(".astra-fixture-badge").count()) === 0);
check("real conversation view renders", (await page.locator(".messages").count()) >= 1);
await shot("astra-01-chat-empty.png");

// ---------- 3) workspace chooser: centered, generous, half-width pane ----------
await page.locator(".astra-workspace-toggle").click();
await sleep(600);
check("chooser visible on first open", (await page.locator(".astra-workspace-chooser").count()) === 1);
check("chooser has exactly 3 items", (await page.locator(".astra-workspace-item").count()) === 3);
const wsBox = await page.locator(".astra-workspace").boundingBox();
const chooserBox = await page.locator(".astra-workspace-chooser").boundingBox();
if (wsBox && chooserBox) {
	const cx = (chooserBox.x + chooserBox.width / 2 - wsBox.x) / wsBox.width;
	const cy = (chooserBox.y + chooserBox.height / 2 - wsBox.y) / wsBox.height;
	check("chooser centered horizontally", Math.abs(cx - 0.5) < 0.12, `cx=${cx.toFixed(2)}`);
	check("chooser centered vertically", Math.abs(cy - 0.5) < 0.18, `cy=${cy.toFixed(2)}`);
	check("chooser generous width", chooserBox.width >= 300, `w=${Math.round(chooserBox.width)}`);
} else {
	check("chooser geometry", false, "no bounding box");
}
if (wsBox) {
	const frac = wsBox.width / 1600;
	check("right pane ≈ half the main workspace", frac > 0.33 && frac < 0.5, `width=${Math.round(wsBox.width)} (${(frac * 100).toFixed(0)}%)`);
} else {
	check("right pane width", false, "no bounding box");
}
await shot("astra-02-chooser.png");

// ---------- 4) files tab + inline preview with a way back ----------
await page.locator(".astra-workspace-item").filter({ hasText: "Files" }).click();
await sleep(1000);
const fileCount = await page.locator(".astra-workspace-content .file-item.file").count();
check("workspace lists project files", fileCount > 0);
await page.locator(".astra-workspace-content .file-item.file").first().locator("button.file-name").click();
await sleep(1200);
check("inline preview mounted in workspace (no modal)", (await page.locator(".astra-workspace .fp-inline").count()) === 1);
check("no modal overlay preview on top", (await page.locator(".fp-overlay").count()) === 0);
const bodyText = await page.locator(".astra-workspace .fp-inline .fp").innerText().catch(() => "");
check("preview shows file content", bodyText.toLowerCase().includes("astra sample"));
checkVisible(page, "inline preview has a back button", ".fp-inline .fp-attach.back");
await shot("astra-03-files-inline.png");
await page.locator(".fp-inline .fp-attach.back").click();
await sleep(800);
check("back returns to the file tree", (await page.locator(".astra-workspace-content .file-item.file").count()) > 0);

// Regression: with a tab selected, the workspace back button resets to the
// chooser (workspaceTab -> null) instead of leaving a blank/unreachable pane.
checkVisible(page, "workspace back button available after Files", ".astra-workspace-back");
await page.locator(".astra-workspace-back").click();
await sleep(500);
checkVisible(page, "back from Files returns to chooser", ".astra-workspace-chooser");
check("chooser offers Files again", (await page.locator(".astra-workspace-item").count()) === 3);

// Re-enter Files to prove the chooser round-trip stays fully usable.
await page.locator(".astra-workspace-item").filter({ hasText: "Files" }).click();
await sleep(800);
check("Files re-reachable after chooser round-trip", (await page.locator(".astra-workspace-content .file-item.file").count()) > 0);

// ---------- 5) terminal: compact strip, no command sidebar ----------
// Toggle from the always-available header button (not only the keyboard), and
// assert the aria state tracks open/close independently of the workspace tab.
const termToggle = page.locator(".astra-terminal-toggle");
check("header terminal toggle present while Files open", (await termToggle.count()) === 1);
check("terminal toggle starts collapsed", (await termToggle.getAttribute("aria-pressed")) === "false");
await termToggle.click();
await sleep(1200);
checkVisible(page, "bottom terminal strip visible", ".astra-bottom-terminal");
check("terminal toggle reports open", (await termToggle.getAttribute("aria-pressed")) === "true");
check("terminal toggle reports expanded", (await termToggle.getAttribute("aria-expanded")) === "true");
const createdTabs = await page.locator(".term-strip .term-tab").count();
check("exactly one terminal created on open", createdTabs === 1, `tabs=${createdTabs}`);
check("old command-management sidebar gone", (await page.locator(".term-commands").count()) === 0);
checkVisible(page, "compact tab strip", ".term-strip");
check("strip holds a terminal tab", (await page.locator(".term-strip .term-tab").count()) >= 1);
const termBox = await page.locator(".astra-bottom-terminal").boundingBox();
const leftBox = await page.locator(".drawer-left .panel").first().boundingBox().catch(() => null);
if (termBox && leftBox) {
	check("terminal strip starts right of left nav", termBox.x >= leftBox.x + leftBox.width - 1);
} else {
	check("terminal strip geometry", false, "no bounding box");
}
await page.locator(".term-strip-cmds").click();
await sleep(400);
checkVisible(page, "commands popover opens", ".term-cmd-pop");
await page.locator(".term-pop-backdrop").click();
await sleep(300);
check("commands popover closes", (await page.locator(".term-cmd-pop").count()) === 0);
await shot("astra-04-terminal.png");

// Close then reopen via the same header toggle: the strip hides, aria flips,
// and reopening must NOT spawn a second PTY (no duplicate creation).
await termToggle.click();
await sleep(600);
check("strip hidden after close", !(await page.locator(".astra-bottom-terminal .term-strip").isVisible().catch(() => false)));
check("terminal toggle reports closed", (await termToggle.getAttribute("aria-pressed")) === "false");
await termToggle.click();
await sleep(1000);
checkVisible(page, "strip visible again after reopen", ".astra-bottom-terminal");
const reopenedTabs = await page.locator(".term-strip .term-tab").count();
check("reopen keeps a single terminal (no duplicate PTY)", reopenedTabs === createdTabs, `tabs=${reopenedTabs}`);

await browser.close();
server.kill();
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
