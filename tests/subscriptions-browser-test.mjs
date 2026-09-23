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
const now = Date.now();
const at = (hours) => new Date(now + hours * 3_600_000).toISOString();
const response = {
	status: "ready",
	refreshAfterMs: 180000,
	providers: [
		{
			providerId: "openai-codex",
			displayName: "Codex",
			state: "ok",
			plan: "Pro",
			windows: [
				{ label: "5-hour", windowSeconds: 18000, usedPercent: 42, resetsAt: at(2.25) },
				{ label: "Weekly", windowSeconds: 604800, usedPercent: 68, resetsAt: at(80) },
			],
			fetchedAt: at(-0.02),
			checkedAt: at(-0.02),
		},
		{
			providerId: "opencode-go",
			displayName: "OpenCode Go",
			state: "ok",
			plan: "Go",
			windows: [{ label: "5-hour", windowSeconds: 18000, usedPercent: 87, resetsAt: at(1.5) }],
			fetchedAt: at(-0.02),
			checkedAt: at(-0.02),
		},
		{
			providerId: "command-code",
			displayName: "Command Code",
			state: "ok",
			plan: "Pro",
			windows: [
				{ label: "5-hour", windowSeconds: 18000, usedPercent: 25, resetsAt: at(2) },
				{ label: "Weekly", windowSeconds: 604800, usedPercent: 42, resetsAt: at(80) },
				{ label: "Monthly", windowSeconds: 2592000, usedPercent: 100, resetsAt: at(200) },
			],
			credits: [
				{ label: "Included", remaining: 40, unit: "credits" },
				{ label: "Purchased", remaining: 10, unit: "credits" },
				{ label: "Free", remaining: 5, unit: "credits" },
			],
			fetchedAt: at(-0.02),
			checkedAt: at(-0.02),
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
	const codexButton = footer.getByRole("button", { name: "Codex", exact: true });
	const goButton = footer.getByRole("button", { name: "OpenCode Go", exact: true });
	for (const name of ["Codex", "OpenCode Go", "Command Code"]) {
		const button = footer.getByRole("button", { name, exact: true });
		assert.equal(await button.getAttribute("title"), name, "provider name appears on hover");
		assert.equal((await button.innerText()).trim(), "", "provider buttons are icon-only");
		assert(await button.locator("img,svg").count(), "provider has a brand icon");
	}
	await codexButton.click();
	const popover = page.locator('[role="dialog"].subscription-popover');
	await popover.waitFor();
	assert.match(await popover.innerText(), /42% used/);
	assert.equal(await popover.locator('[role="progressbar"]').first().getAttribute("aria-valuenow"), "42");
	const refreshButton = popover.getByRole("button", { name: "Refresh Codex usage", exact: true });
	assert.equal(await refreshButton.getAttribute("title"), "Refresh");
	assert.equal((await refreshButton.innerText()).trim(), "", "refresh is icon-only");
	assert.match(await popover.innerText(), /Resets/);
	await goButton.click();
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
	await eventually(() => goButton.evaluate((el) => document.activeElement === el), "focus restoration");
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
	await codexButton.click();
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
	// The popover repositions after the viewport change; measure once layout settles.
	await eventually(async () => {
		const mobileBox = await popover.boundingBox();
		return (
			mobileBox &&
			mobileBox.x >= -2 &&
			mobileBox.y >= -2 &&
			mobileBox.x + mobileBox.width <= 392 &&
			mobileBox.y + mobileBox.height <= 846
		);
	}, "mobile popover fits the viewport");
	assert.equal(await page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth), true);
	await page.screenshot({ path: join(artifactDir, "subscriptions-mobile.png"), fullPage: true });
	await footer.getByRole("button", { name: "Command Code", exact: true }).click();
	assert.match(await popover.innerText(), /Total credits\s+55 credits/);
	assert.doesNotMatch(await popover.innerText(), /Included|Purchased|Free/);
	assert.equal(await popover.locator('[role="progressbar"]').count(), 3, "Command Code quota windows stay unchanged");
	assert(
		await popover.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
		"Command Code fits without scrolling on mobile",
	);
	await page.screenshot({ path: join(artifactDir, "subscriptions-command-mobile.png"), fullPage: true });
	await page.setViewportSize({ width: 1440, height: 900 });
	assert(
		await popover.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
		"Command Code fits without scrolling on desktop",
	);
	await page.screenshot({ path: join(artifactDir, "subscriptions-command-desktop.png"), fullPage: true });
	// Wider font metrics reproduced the Linux CI regression: a fixed 64px
	// label wrapped "% used" and made all three quota rows too tall.
	await page.addStyleTag({
		content: ".subscription-percent { font-family: monospace !important; font-size: 14px !important; }",
	});
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1440, height: 900 },
	]) {
		await page.setViewportSize(viewport);
		assert(
			await popover.locator(".subscription-percent").evaluateAll((labels) =>
				labels.every((label) => {
					const range = document.createRange();
					range.selectNodeContents(label);
					const rects = [...range.getClientRects()];
					return (
						rects.length > 0 &&
						rects.every((rect) => Math.abs(rect.top - rects[0].top) < 1) &&
						label.scrollWidth <= label.clientWidth + 1
					);
				}),
			),
			"percentages stay on one line with wider fonts",
		);
		assert(
			await popover.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1),
			"Command Code fits with wider fonts",
		);
	}
	await context.close();
	console.log("subscription footer checks passed");
} catch (error) {
	await page?.screenshot({ path: join(artifactDir, "subscriptions-failure.png") }).catch(() => {});
	console.error(fixture.serverLog());
	throw error;
} finally {
	await fixture.close();
}
