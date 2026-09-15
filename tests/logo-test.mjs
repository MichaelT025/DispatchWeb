// Supplied Dispatch artwork: real UI slots, light/dark contexts, and favicon.
// Temporary agent directory; no credentials or provider/model requests.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBrowserFixture, artifactDir, dismissSetup } from "./lib/browser-fixture.mjs";

const base = mkdtempSync(join(tmpdir(), "dispatch-logo-"));
const cwd = join(base, "project");
mkdirSync(cwd);
const fixture = await startBrowserFixture({ cwd, agentDir: join(base, "agent"), dataDir: join(base, "data") });
const RED = "rgb(252, 11, 18)";
let checks = 0;
function check(name, ok) {
	assert.ok(ok, name);
	console.log(`PASS ${name}`);
	checks++;
}
async function checkSlot(mark, size) {
	await mark.waitFor({ state: "visible" });
	const svg = mark.locator("svg");
	assert.equal(await svg.getAttribute("viewBox"), "180 180 735 735");
	const hostBox = await mark.boundingBox();
	const svgBox = await svg.boundingBox();
	check(
		`${size}px logo and SVG fill their slot`,
		[hostBox, svgBox].every((b) => b?.width === size && b?.height === size),
	);
	const geometry = await svg.evaluate((el) => {
		const box = el.getBBox();
		return { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height };
	});
	check(
		`${size}px geometry is not clipped`,
		geometry.x >= 180 && geometry.y >= 180 && geometry.right <= 915 && geometry.bottom <= 915,
	);
}
async function checkColors(mark, expectedInk) {
	const colors = await mark.evaluate((el) => ({
		ink: [...el.querySelectorAll('path[fill="currentColor"]')].map((p) => getComputedStyle(p).fill),
		core: [...el.querySelectorAll('path[fill="#fc0b12"]')].map((p) => getComputedStyle(p).fill),
	}));
	check("foreground follows its theme", colors.ink.length === 2 && colors.ink.every((c) => c === expectedInk));
	check("red core stays fixed", colors.core.length === 1 && colors.core[0] === RED);
}
try {
	const context = await fixture.browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: "dark" });
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(fixture.url);
	await dismissSetup(page);
	const brand = page.locator(".lp-brand .pi-mark");
	const empty = page.locator(".astra-empty-logo");
	await checkSlot(brand, 20);
	await checkSlot(empty, 44);
	const darkColor = await brand.evaluate((el) => getComputedStyle(el).color);
	await checkColors(brand, darkColor);
	await brand.screenshot({ path: join(artifactDir, "logo-dark-ui.png") });
	await empty.screenshot({ path: join(artifactDir, "logo-empty-dark-ui.png") });

	// Isolated light-color context using the actual rendered markup and the
	// component's size rules; does not imply a new app theme preference exists.
	const light = await context.newPage();
	const markup = await brand.innerHTML();
	await light.setContent(`<html><body style="margin:0;background:white;color:#17171a">
		<style>.mark{display:inline-flex} .mark svg{width:100%;height:100%}</style>
		<div id="sample" style="padding:24px"><span class="mark" id="large" style="width:44px;height:44px">${markup}</span>
		<span class="mark" id="small" style="width:12px;height:12px">${markup}</span></div></body></html>`);
	await checkSlot(light.locator("#small"), 12);
	await checkSlot(light.locator("#large"), 44);
	await checkColors(light.locator("#large"), "rgb(23, 23, 26)");
	check("foreground differs between dark and light contexts", darkColor !== "rgb(23, 23, 26)");
	await light.locator("#sample").screenshot({ path: join(artifactDir, "logo-light-context.png") });
	await light.close();

	// Navigate to the actual SVG document: missing/stale favicon is a failure,
	// never a skipped assertion. Evaluate its own media-query style rules.
	for (const [scheme, ink, bg] of [
		["dark", "rgb(245, 245, 246)", "#131316"],
		["light", "rgb(23, 23, 26)", "white"],
	]) {
		const icon = await context.newPage();
		await icon.setViewportSize({ width: 64, height: 64 });
		await icon.emulateMedia({ colorScheme: scheme });
		const response = await icon.goto(`${fixture.url}/favicon.svg?v=dispatch-logo-2`);
		assert.equal(response.status(), 200);
		assert.equal(await icon.locator("svg").getAttribute("viewBox"), "180 180 735 735");
		const colors = await icon.evaluate((background) => {
			document.documentElement.style.backgroundColor = background;
			return {
				ink: [...document.querySelectorAll(".ink")].map((p) => getComputedStyle(p).fill),
				core: [...document.querySelectorAll(".core")].map((p) => getComputedStyle(p).fill),
			};
		}, bg);
		check(`favicon adapts to ${scheme} browser theme`, colors.ink.length === 2 && colors.ink.every((c) => c === ink));
		check(`favicon red stays fixed in ${scheme} theme`, colors.core.length === 1 && colors.core[0] === RED);
		await icon.screenshot({ path: join(artifactDir, `logo-favicon-${scheme}.png`) });
		await icon.close();
	}
	check("logo rendering has no page errors", errors.length === 0);
	await context.close();
	console.log(`${checks} logo checks passed`);
} finally {
	await fixture.close();
	rmSync(base, { recursive: true, force: true });
}
