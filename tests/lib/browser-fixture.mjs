import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./chrome.mjs";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const artifactDir = process.env.PI_WEB_TEST_ARTIFACTS || join(repoRoot, "test-results", "browser");
mkdirSync(artifactDir, { recursive: true });

export async function startBrowserFixture({ cwd, agentDir, dataDir, sessionRoot }) {
	const reservation = createServer();
	await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const server = spawn(process.execPath, [join(repoRoot, "dist/server/index.js")], {
		cwd: repoRoot,
		windowsHide: true,
		env: {
			...process.env,
			PI_WEB_HOST: "127.0.0.1",
			PI_WEB_PORT: String(port),
			PI_WEB_CWD: cwd,
			PI_WEB_DATA_DIR: dataDir,
			PI_CODING_AGENT_DIR: agentDir,
			PI_CODING_AGENT_SESSION_DIR: sessionRoot || "",
			PI_WEB_TOKEN: "",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let serverLog = "";
	for (const stream of [server.stdout, server.stderr])
		stream.on("data", (data) => {
			serverLog += data;
		});
	let browser;
	const close = async () => {
		try {
			await browser?.close();
		} finally {
			if (server.exitCode === null) {
				const exited = new Promise((resolve) => server.once("exit", resolve));
				server.kill();
				await Promise.race([exited, sleep(3000)]);
			}
		}
	};
	try {
		const url = `http://127.0.0.1:${port}`;
		let healthy = false;
		for (let i = 0; i < 150; i++) {
			if (server.exitCode !== null) break;
			try {
				if ((await fetch(`${url}/api/health`)).ok) {
					healthy = true;
					break;
				}
			} catch {
				/* starting */
			}
			await sleep(100);
		}
		if (!healthy) throw new Error(`Server did not become ready:\n${serverLog}`);
		browser = await chromium.launch({ executablePath: CHROME_PATH || undefined });
		return { browser, url, close, serverLog: () => serverLog };
	} catch (error) {
		await close();
		throw error;
	}
}

export async function eventually(predicate, description, timeoutMs = 10000) {
	const end = Date.now() + timeoutMs;
	do {
		if (await predicate()) return;
		await sleep(100);
	} while (Date.now() < end);
	throw new Error(`Timed out: ${description}`);
}

export async function dismissSetup(page) {
	await page.locator('.lp-footer-status[title="Connected"]').waitFor({ state: "visible", timeout: 15000 });
	const close = page.locator(".modal-backdrop .modal-close");
	if (await close.count()) await close.first().click();
}
