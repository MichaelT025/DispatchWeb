// Zero-provider browser regression: real server state, synthetic saved transcript.
// Build first: npm run build:web -- --outDir ../tests/scratch/codex-dist
// Then: npm run build:server -- --outDir tests/scratch/codex-server
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { preview } from "vite";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./lib/chrome.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "piweb-codex-"));
const work = join(base, "workspace");
const agent = join(base, "agent");
const data = join(base, "data");
const sessions = join(base, "sessions");
const evidence = join(root, "tests", "scratch", "codex-qa");
for (const dir of [work, agent, data, sessions, evidence, join(agent, "extensions")])
	mkdirSync(dir, { recursive: true });
writeFileSync(join(work, "readme.md"), "# Workspace notes\n\nA local file preview, with **Markdown** rendering.\n");
const cid = randomUUID();
const timestamp = new Date().toISOString();
// Same JSONL fixture format used by astra-agent-sidebar-test.mjs.
writeFileSync(
	join(sessions, "sample.jsonl"),
	[
		{ type: "session", version: 3, id: "sample", timestamp, cwd: work },
		{
			type: "message",
			id: "u",
			parentId: null,
			timestamp,
			message: { role: "user", content: "Review the workspace layout" },
		},
		{
			type: "message",
			id: "a",
			parentId: "u",
			timestamp,
			message: {
				role: "assistant",
				content: [
					{
						type: "text",
						text: "The workspace keeps the conversation, files and terminal together.\n\n- Project navigation stays on the left.\n- Files open alongside the discussion.\n- The terminal retains its session when closed.\n\n中文排版检查：项目导航与文件预览保持清晰。",
					},
				],
				api: "openai-responses",
				provider: "openai",
				model: "fixture",
				stopReason: "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		},
	]
		.map((entry) => JSON.stringify(entry))
		.join("\n") + "\n",
);
writeFileSync(
	join(data, "client-state.json"),
	JSON.stringify({ [cid]: { lastCwd: work, lastUsedModel: {}, projects: [{ path: work, lastUsed: Date.now() }] } }),
);
// Existing test-only status bridge pattern: role clicks cannot reach a provider.
writeFileSync(
	join(agent, "extensions", "roles.js"),
	`export default function(pi) {
	pi.registerCommand("agent", { description: "Select agent", handler: async (role, ctx) => ctx.ui.setStatus("piastra-agent", "Agent: " + role.trim()) });
	pi.registerCommand("piastra", { description: "Role status", handler: async () => {} });
}`,
);
const port = 46000 + Math.floor(Math.random() * 1000);
const uiPort = port + 1000;
const server = spawn(process.execPath, ["tests/scratch/codex-server/index.js"], {
	cwd: root,
	env: {
		...process.env,
		PI_WEB_PORT: String(port),
		PI_WEB_ALLOW_ORIGINS: `http://localhost:${uiPort}`,
		PI_WEB_CWD: work,
		PI_WEB_DATA_DIR: data,
		PI_CODING_AGENT_DIR: agent,
		PI_CODING_AGENT_SESSION_DIR: sessions,
	},
	stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (chunk) => {
	logs += chunk;
});
server.stderr.on("data", (chunk) => {
	logs += chunk;
});
let browser;
let ui;
try {
	// Subscribe to server startup output, with bounded timeout, rather than sleep.
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${logs}`)), 90000);
		server.stdout.on("data", () => {
			if (logs.includes(`:${port}`)) {
				clearTimeout(timer);
				resolve();
			}
		});
		server.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`Server exited ${code}: ${logs}`));
		});
	});
	const proxy = Object.fromEntries(
		["/api", "/themes", "/plugins", "/ws"].map((path) => [
			path,
			{ target: `http://localhost:${port}`, ws: path === "/ws" },
		]),
	);
	ui = await preview({
		configFile: join(root, "web", "vite.config.ts"),
		build: { outDir: join(root, "tests", "scratch", "codex-dist") },
		preview: { port: uiPort, strictPort: true, proxy },
	});
	browser = await chromium.launch({ executablePath: CHROME_PATH });
	const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
	await context.addInitScript((id) => {
		sessionStorage.setItem("pi-web-client-id", id);
		localStorage.setItem("pi-web-ui:locale", "en");
	}, cid);
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const shot = async (name) => {
		await page.evaluate(async () => {
			await document.fonts.ready;
			await Promise.all(
				document
					.getAnimations()
					.filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
					.map((animation) => animation.finished.catch(() => {})),
			);
		});
		await page.screenshot({ path: join(evidence, `${name}.png`) });
	};
	await page.goto(`http://localhost:${uiPort}`);
	await page.locator(".lp-footer .conn-dot.ok").waitFor();
	await page.locator(".modal-backdrop .modal-close").first().click();
	await page.locator(".astra-empty").waitFor();
	assert.equal(await page.locator(".astra-column > .astra-header").count(), 1);
	const sidebar = await page.locator(".lp-panel").boundingBox();
	assert.equal(sidebar.y, 0);
	assert.equal(sidebar.height, 900);
	await shot("01-empty-desktop");
	await page.locator(".lp-search").click();
	await page.locator(".gs-modal").waitFor();
	await page.keyboard.press("Escape");
	await page.locator(".lp-nav .session-item").filter({ hasText: "Review the workspace layout" }).first().click();
	await page.locator(".msg-assistant").waitFor();
	await page.waitForFunction(
		() => document.querySelector(".astra-project")?.textContent === "Review the workspace layout",
		undefined,
		{ timeout: 5000 },
	);
	const bubble = await page.locator(".msg-user .msg-body").first().boundingBox();
	const user = await page.locator(".msg-user").first().boundingBox();
	assert.ok(bubble.x > user.x && bubble.width < user.width * 0.71);
	await shot("02-conversation-desktop");
	for (const role of ["orchestrator", "general", "fast", "review"]) {
		// Roles sit in a menu behind the composer pill.
		await page.locator(".agent-picker-pill").click();
		await page.locator(`[data-agent-role="${role}"]`).click();
		await page.locator(`[data-agent-role="${role}"][aria-pressed="true"]`).waitFor();
		assert.equal(await page.locator(".inputbox").evaluate((el) => getComputedStyle(el).boxShadow), "none");
		await shot(`agent-${role}`);
	}
	await page.keyboard.press("Control+p");
	await page.locator(".file-item.file .file-name").first().click();
	await page.locator(".fp-inline .md").waitFor();
	assert.equal(await page.locator(".fp-markdown").evaluate((el) => getComputedStyle(el).backgroundImage), "none");
	await shot("03-files-desktop");
	await page.locator(".astra-terminal-toggle").click();
	await page.locator(".term-tab").first().waitFor();
	await page.locator(".xterm-screen").waitFor();
	await page.waitForFunction(
		() => document.querySelector(".astra-bottom-terminal")?.getBoundingClientRect().height === 280,
	);
	await page.locator(".xterm-helper-textarea").pressSequentially("echo CODEX_SHELL_QA");
	await page.locator(".xterm-helper-textarea").press("Enter");
	await page.waitForFunction(() => document.querySelector(".xterm-rows")?.textContent?.includes("CODEX_SHELL_QA"));
	await shot("04-terminal-desktop");
	const tabs = await page.locator(".term-tab").count();
	await page.locator(".astra-terminal-toggle").click();
	await page.locator(".astra-terminal-toggle").click();
	assert.equal(await page.locator(".term-tab").count(), tabs);
	await page.locator(".astra-terminal-toggle").click();
	await page.locator(".astra-workspace-close").click();
	await page.locator('.inputbox input[type="file"]').setInputFiles(join(work, "readme.md"));
	await page.locator(".attach-chip.file").waitFor();
	await shot("08-attachment");
	await page.locator(".attach-remove").click();
	await page.locator(".tpl-open").click();
	await page.locator(".modal-backdrop").waitFor();
	await shot("09-templates");
	await page.keyboard.press("Escape");
	await page.locator('.astra-header-right button[title="Settings"]').click();
	await page.locator(".settings-modal").waitFor();
	await shot("10-settings");
	await page.locator(".settings-modal .modal-close").click();
	await page.locator(".astra-header-right .dropdown .chip").click();
	await page
		.locator(".dd-item")
		.filter({ hasText: /^White$|^白色$/ })
		.click();
	await page.waitForFunction(() => document.getElementById("theme-stylesheet")?.sheet);
	const colors = await page.locator(".app").evaluate((el) => ({
		app: getComputedStyle(el).getPropertyValue("--bg").trim(),
		root: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
	}));
	assert.equal(colors.app, colors.root);
	assert.notEqual(colors.app, "#0d0d0e");
	await page.keyboard.press("Escape");
	await shot("05-light-desktop");
	await page.locator(".astra-header-right .dropdown .chip").click();
	await page.locator(".dd-item").filter({ hasText: "Dark (default)" }).click();
	await page.waitForFunction(() => !document.getElementById("theme-stylesheet"));
	await page.keyboard.press("Escape");
	for (const width of [1280, 768, 375]) {
		await page.setViewportSize({ width, height: 900 });
		await page.waitForFunction(
			(mobile) =>
				!!document.querySelector(".panel-toggle") &&
				(getComputedStyle(document.querySelector(".panel-toggle")).display !== "none") === mobile,
			width <= 768,
		);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await shot(`06-responsive-${width}`);
		if (width <= 768) {
			await page.locator(".panel-toggle").click();
			await page.locator(".drawer-left.open").waitFor();
			await shot(`07-drawer-${width}`);
			assert.equal(Math.round((await page.locator(".drawer-left").boundingBox()).x), 0);
			await page.locator(".drawer-backdrop").click({ position: { x: width - 10, y: 450 } });
			await page.waitForFunction(() => !document.querySelector(".drawer-left.open"));
		}
	}
	assert.deepEqual(errors, []);
	writeFileSync(
		join(evidence, "result.json"),
		JSON.stringify({ verdict: "PASS", port, uiPort, colors, errors, screenshots: evidence }, null, 2),
	);
	console.log(
		`PASS: shell, sidebar search, saved title/messages, four role states, files, terminal input/lifecycle, attachments, templates, settings, light theme, responsive drawer. Evidence: ${evidence}`,
	);
} finally {
	await browser?.close();
	await new Promise((resolve) => {
		if (ui) ui.httpServer.close(resolve);
		else resolve();
	});
	if (server.exitCode === null && server.signalCode === null) {
		const exited = once(server, "exit");
		if (process.platform === "win32") {
			const cleanup = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
			await once(cleanup, "exit");
		} else {
			server.kill();
		}
		await exited;
	}
	writeFileSync(join(evidence, "server.log"), logs);
}
