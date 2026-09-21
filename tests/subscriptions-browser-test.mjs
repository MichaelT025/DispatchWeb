// Subscription footer regression coverage. API responses are fully deterministic.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactDir, dismissSetup, eventually, repoRoot, startBrowserFixture } from "./lib/browser-fixture.mjs";

const base = mkdtempSync(join(tmpdir(), "piastra-subscriptions-"));
const workdir = join(base, "work");
mkdirSync(workdir);
const previousPkgRoot = process.env.PI_WEB_PKG_ROOT;
process.env.PI_WEB_PKG_ROOT = repoRoot;
let fixture;
try {
	fixture = await startBrowserFixture({ cwd: workdir, agentDir: join(base, "agent"), dataDir: join(base, "data") });
} finally {
	if (previousPkgRoot === undefined) delete process.env.PI_WEB_PKG_ROOT;
	else process.env.PI_WEB_PKG_ROOT = previousPkgRoot;
}
const response = {
	status: "ready",
	refreshAfterMs: 180000,
	providers: [
		{
			providerId: "openai-codex",
			displayName: "Codex",
			state: "ok",
			plan: "Pro",
			windows: [{ label: "5 hour limit", windowSeconds: 18000, usedPercent: 42, resetsAt: "2099-01-01T00:00:00Z" }],
			fetchedAt: "2098-12-31T00:00:00Z",
			checkedAt: "2098-12-31T00:00:00Z",
		},
		{
			providerId: "opencode-go",
			displayName: "OpenCode Go",
			state: "ok",
			windows: [{ label: "Daily", windowSeconds: 86400, usedPercent: 87, resetsAt: "2099-01-01T00:00:00Z" }],
			fetchedAt: "2098-12-31T00:00:00Z",
			checkedAt: "2098-12-31T00:00:00Z",
		},
		{
			providerId: "command-code",
			displayName: "Command Code",
			state: "ok",
			windows: [],
			fetchedAt: null,
			checkedAt: "",
		},
		{
			providerId: "anthropic",
			displayName: "Anthropic",
			state: "unconfigured",
			windows: [],
			fetchedAt: null,
			checkedAt: "",
		},
	],
};
let page;
try {
	const context = await fixture.browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
	page = await context.newPage();
	const posts = [];
	await page.route("**/api/subscriptions?**", async (route) => {
		if (route.request().method() === "POST") posts.push(await route.request().postDataJSON());
		await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
	});
	await page.goto(fixture.url);
	await dismissSetup(page);
	assert.equal(await page.locator(".subscription-footer").count(), 0, "footer is absent while workspace is closed");
	await page.locator(".astra-workspace-toggle").click();
	const footer = page.locator(".subscription-footer");
	await footer.waitFor();
	await eventually(
		() =>
			footer
				.locator(".subscription-provider-button")
				.count()
				.then((count) => count === 3),
		"provider buttons",
	);
	assert.equal(await footer.getByRole("button", { name: /Anthropic/ }).count(), 0);
	const buttons = footer.locator(".subscription-provider-button");
	await buttons.filter({ hasText: "Codex" }).click();
	const popover = page.locator('[role="dialog"].subscription-popover');
	await popover.waitFor();
	assert.match(await popover.innerText(), /42% used/);
	assert.equal(await popover.locator('[role="progressbar"]').getAttribute("aria-valuenow"), "42");
	assert.match(await popover.innerText(), /Resets/);
	await buttons.filter({ hasText: "Go" }).click();
	assert.equal(
		await page.locator('[role="dialog"].subscription-popover').count(),
		1,
		"only one provider popover is open",
	);
	assert.match(await popover.innerText(), /87% used/);
	const postResponse = page.waitForResponse(
		(request) => request.url().includes("/api/subscriptions?") && request.request().method() === "POST",
	);
	await popover.getByRole("button", { name: /Refresh OpenCode Go usage/ }).click();
	await postResponse;
	await eventually(() => posts.length === 1, "subscription refresh POST");
	assert.deepEqual(posts, [{ providerId: "opencode-go" }]);
	await page.keyboard.press("Escape");
	await eventually(() => popover.count().then((count) => count === 0), "popover dismissal");
	await eventually(
		() =>
			page
				.locator(".subscription-provider-button")
				.filter({ hasText: "Go" })
				.evaluate((el) => document.activeElement === el),
		"focus restoration",
	);
	// Exercise an isolated light-token context; this app has no downloadable
	// theme endpoint. A CSS URL returning the SPA shell is not a light-theme test.
	const applyTheme = async (theme) =>
		page.evaluate((id) => {
			const footer = document.querySelector(".subscription-usage");
			if (id === "dark") {
				footer.removeAttribute("style");
				return;
			}
			const tokens = {
				"--bg": "#fff",
				"--bg-elev": "#fafafa",
				"--bg-elev2": "#eee",
				"--border": "#ccc",
				"--border-soft": "#ddd",
				"--text": "#17171a",
				"--text-dim": "#555",
				"--text-faint": "#666",
				"--green": "#087f5b",
				"--amber": "#916400",
				"--red": "#b42318",
			};
			for (const [key, value] of Object.entries(tokens)) footer.style.setProperty(key, value);
		}, theme);
	await applyTheme("white");
	await buttons.filter({ hasText: "Codex" }).click();
	await popover.waitFor();
	assert.equal(await popover.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(250, 250, 250)");
	const desktopBox = await popover.boundingBox();
	const footerBox = await footer.boundingBox();
	assert(
		desktopBox && footerBox && desktopBox.y + desktopBox.height <= footerBox.y + 2,
		"desktop popover is above footer",
	);
	assert(
		desktopBox.x >= -2 &&
			desktopBox.y >= -2 &&
			desktopBox.x + desktopBox.width <= 1442 &&
			desktopBox.y + desktopBox.height <= 902,
	);
	await page.screenshot({ path: join(artifactDir, "subscriptions-light.png"), fullPage: true });
	await applyTheme("dark");
	await page.screenshot({ path: join(artifactDir, "subscriptions-dark.png"), fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await eventually(
		() =>
			page
				.locator(".subscription-popover")
				.count()
				.then((count) => count === 1),
		"mobile popover remains open",
	);
	const mobileBox = await popover.boundingBox();
	assert(
		mobileBox &&
			mobileBox.x >= -2 &&
			mobileBox.y >= -2 &&
			mobileBox.x + mobileBox.width <= 392 &&
			mobileBox.y + mobileBox.height <= 846,
	);
	assert.equal(await page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth), true);
	await page.screenshot({ path: join(artifactDir, "subscriptions-mobile.png"), fullPage: true });
	await context.close();
	console.log("subscription footer checks passed");
} catch (error) {
	await page?.screenshot({ path: join(artifactDir, "subscriptions-failure.png") }).catch(() => {});
	console.error(fixture.serverLog());
	throw error;
} finally {
	await fixture.close();
}
