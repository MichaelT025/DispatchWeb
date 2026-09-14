// Production shell regression coverage. Temporary workspace, no provider calls.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startBrowserFixture, artifactDir, eventually, dismissSetup } from "./lib/browser-fixture.mjs";

const base = mkdtempSync(join(tmpdir(), "piastra-shell-"));
const workdir = join(base, "work");
mkdirSync(workdir);
writeFileSync(join(workdir, "readme.md"), "# Astra sample file\nsome *markdown* body\n");
execFileSync("git", ["init", "--initial-branch=main"], { cwd: workdir, stdio: "ignore" });
execFileSync("git", ["add", "readme.md"], { cwd: workdir });
execFileSync("git", ["-c", "user.name=CI", "-c", "user.email=ci@example.invalid", "commit", "-m", "QA fixture"], {
	cwd: workdir,
	stdio: "ignore",
});
writeFileSync(join(workdir, "readme.md"), "# Astra sample file\nsome *markdown* body\nChanged in QA\n");
const fixture = await startBrowserFixture({ cwd: workdir, agentDir: join(base, "agent"), dataDir: join(base, "data") });
let page;
let checks = 0;
const check = (name, ok) => {
	assert(ok, name);
	checks++;
	console.log(`PASS ${name}`);
};
try {
	const context = await fixture.browser.newContext({ viewport: { width: 1600, height: 900 } });
	page = await context.newPage();
	const errors = [];
	let terminalOutput = "";
	page.on("websocket", (socket) =>
		socket.on("framereceived", ({ payload }) => {
			try {
				const m = JSON.parse(String(payload));
				if (m.type === "terminal_output") terminalOutput += m.data;
			} catch {}
		}),
	);
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(fixture.url);
	await dismissSetup(page);
	await page.locator(".astra-empty").waitFor();
	check("empty state and composer render", await page.locator(".inputbar textarea").isVisible());
	check("four retained header controls", (await page.locator(".astra-header-right > button.chip").count()) === 4);
	check(
		"removed UI is absent",
		(await page.locator(".bg-task-chip, .astra-header-right .dropdown, .empty-templates, .quick-row").count()) === 0,
	);
	check(
		"role badge is neutral without PiAstra extension",
		(await page.locator(".agent-picker-unavailable").count()) === 1,
	);

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Conversation", exact: true }).waitFor();
	check("settings retained", await page.getByRole("button", { name: "System prompt", exact: true }).isVisible());
	await page.locator(".modal-close").click();
	await page.locator(".astra-workspace-toggle").click();
	await page.locator(".astra-workspace-chooser").waitFor();
	check("chooser has files/review/workers/terminal", (await page.locator(".astra-workspace-item").count()) === 4);
	await page.locator(".astra-workspace-item").filter({ hasText: "Files" }).click();
	await page.locator("button.file-name").filter({ hasText: "readme.md" }).click();
	await page.locator(".fp-inline").waitFor();
	await page.locator(".fp-inline").getByRole("heading", { name: "Astra sample file", exact: true }).waitFor();
	check("inline Markdown preview", true);
	check("preview is not a modal", (await page.locator(".fp-overlay").count()) === 0);
	await page.locator(".fp-inline").getByRole("button", { name: "Attach content to chat", exact: true }).click();
	await eventually(
		() =>
			page
				.locator(".inputbar")
				.innerText()
				.then((text) => text.includes("readme.md")),
		"attachment in composer",
	);
	check("file attachment reaches composer", true);
	await page.locator(".attach-remove").click();
	await page.locator(".fp-inline .fp-attach.back").click();
	await page.locator(".fp-inline").waitFor({ state: "hidden" });
	await page.locator(".astra-workspace-back").click();
	await page.locator(".astra-workspace-chooser").waitFor();
	check("back returns to chooser", true);
	await page.getByRole("tab", { name: "Review", exact: true }).click();
	await page.getByText("Source Control", { exact: true }).waitFor();
	await page.locator(".scm-file").filter({ hasText: "readme.md" }).click();
	await eventually(
		() =>
			page
				.locator(".scm-diff")
				.innerText()
				.then((text) => text.includes("Changed in QA")),
		"git diff content",
	);
	check("Git changes and diff render", true);
	await page.getByRole("tab", { name: "Commit tree", exact: true }).click();
	await page.getByRole("button", { name: /QA fixture/ }).waitFor();
	check("Git history renders", true);
	await page.locator(".astra-workspace-toggle").click();

	await page.locator(".astra-terminal-toggle").click();
	await page.locator(".term-strip .term-tab").waitFor();
	check("opening terminal creates one tab", (await page.locator(".term-strip .term-tab").count()) === 1);
	await page
		.locator(".xterm-helper-textarea")
		.pressSequentially(
			process.platform === "win32" ? "Write-Output ('PIASTRA_' + (19 * 23))" : "echo PIASTRA_$((19 * 23))",
		);
	await page.locator(".xterm-helper-textarea").press("Enter");
	await eventually(() => terminalOutput.includes("PIASTRA_437"), "computed terminal output");
	check("terminal executes input and streams output", true);
	await page.locator(".astra-terminal-toggle").click();
	await page.locator(".astra-terminal-toggle").click();
	check("reopening terminal preserves its tab", (await page.locator(".term-strip .term-tab").count()) === 1);
	await page.locator(".term-strip-cmds").click();
	await page.locator(".term-cmd-pop").waitFor();
	await page.locator(".term-pop-backdrop").click();
	await page.locator(".term-cmd-pop").waitFor({ state: "hidden" });
	check("terminal commands popover opens and closes", true);
	await page.locator(".astra-terminal-toggle").click();
	await page.locator(".inputbar textarea").fill("/cwd");
	await page.locator(".inputbar textarea").press("Escape");
	await page.locator(".inputbar textarea").press("Enter");
	await page.getByText(/Current directory:/).waitFor();
	await page.reload();
	await dismissSetup(page);
	await page.locator(".inputbar textarea").click();
	await page.locator(".inputbar textarea").press("ArrowUp");
	await eventually(
		() =>
			page
				.locator(".inputbar textarea")
				.inputValue()
				.then((value) => value === "/cwd"),
		"input history restored",
	);
	check("sent prompt history survives reload", true);
	await page.locator(".inputbar textarea").fill("first line\nsecond line");
	await page.locator(".inputbar textarea").press("ArrowUp");
	check(
		"multiline cursor movement preserves the draft",
		(await page.locator(".inputbar textarea").inputValue()) === "first line\nsecond line",
	);
	await page.locator(".inputbar textarea").press("Control+Home");
	await page.locator(".inputbar textarea").press("ArrowUp");
	await eventually(
		() =>
			page
				.locator(".inputbar textarea")
				.inputValue()
				.then((value) => value === "/cwd"),
		"history from first line",
	);
	check("first-line cursor recalls history", true);
	await page.locator(".lp-new-chat").click();
	await page.locator(".astra-empty").waitFor();
	check("new chat remains usable", await page.locator(".inputbar textarea").isEnabled());
	check("no uncaught browser errors", errors.length === 0);
	await page.screenshot({ path: join(artifactDir, "shell.png"), fullPage: true });
	console.log(`${checks} shell checks passed`);
} catch (error) {
	await page?.screenshot({ path: join(artifactDir, "shell-failure.png") }).catch(() => {});
	console.error(fixture.serverLog());
	throw error;
} finally {
	await fixture.close();
}
