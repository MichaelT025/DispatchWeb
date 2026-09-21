// Browser regression coverage for live desktop notifications.
//
// The server remains model-free: the page's real compiled WebSocket client is
// fed synthetic notification_event messages before the app receives them. The
// browser Notification and service-worker surfaces are mocked so this test
// never emits an OS toast; Web Locks and localStorage remain Chromium's real
// implementations for the cross-tab delivery assertion.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactDir, dismissSetup, eventually, repoRoot, startBrowserFixture } from "./lib/browser-fixture.mjs";

const base = mkdtempSync(join(tmpdir(), "piastra-notifications-"));
const workdir = join(base, "work");
mkdirSync(workdir);
const previousPkgRoot = process.env.PI_WEB_PKG_ROOT;
process.env.PI_WEB_PKG_ROOT = repoRoot;
let fixture;
let context;
let page;
let second;

const event = (eventId, kind, conversationId = "conversation-notify") => ({
	type: "notification_event",
	eventId,
	conversationId,
	kind,
	projectName: "Dispatch project",
	sessionName: "Synthetic session",
});

async function calls(target) {
	return target.evaluate(() => window.__notificationTest.getCalls());
}

async function totalCalls() {
	return (await calls(page)).length + (second ? (await calls(second)).length : 0);
}

try {
	fixture = await startBrowserFixture({
		cwd: workdir,
		agentDir: join(base, "agent"),
		dataDir: join(base, "data"),
	});
	context = await fixture.browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => {
		// Opt in without exercising the browser permission prompt. The app still
		// goes through its normal settings/permission checks.
		localStorage.setItem("pi-web-notify", JSON.stringify({ enabled: true }));

		const presence = { visibility: "visible", focus: true };
		const notificationCalls = [];
		const registration = {
			active: {},
			showNotification: async (title, options) => {
				notificationCalls.push({ route: "sw", title, options });
			},
			getNotifications: async () => [],
		};
		const serviceWorker = {
			register: async () => registration,
			getRegistration: async () => registration,
			ready: Promise.resolve(registration),
			addEventListener: () => {},
			removeEventListener: () => {},
		};
		try {
			Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
		} catch {
			// The test still has a safe Notification fallback if this browser makes
			// Navigator.serviceWorker non-configurable.
		}

		class MockNotification {
			static permission = "granted";
			static requestPermission = async () => "granted";
			constructor(title, options) {
				notificationCalls.push({ route: "page", title, options });
			}
		}
		Object.defineProperty(window, "Notification", { configurable: true, value: MockNotification });
		// If a browser exposes a non-configurable Navigator.serviceWorker, patch
		// the prototype route as a second guard against real OS notifications.
		try {
			if (typeof ServiceWorkerRegistration !== "undefined") {
				ServiceWorkerRegistration.prototype.showNotification = async (title, options) => {
					notificationCalls.push({ route: "sw", title, options });
				};
			}
		} catch {
			/* best effort; the mocked Notification constructor is still safe */
		}

		// Make presence deterministic in headless Chromium without changing the
		// real browser APIs used by Web Locks or localStorage.
		try {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => presence.visibility,
			});
		} catch {
			/* best effort; hasFocus is sufficient for the unfocused case */
		}
		document.hasFocus = () => presence.focus;

		const OriginalWebSocket = window.WebSocket;
		const sockets = [];
		class InterceptedWebSocket extends OriginalWebSocket {
			constructor(...args) {
				super(...args);
				sockets.push(this);
			}
		}
		window.WebSocket = InterceptedWebSocket;
		window.__notificationTest = {
			getCalls: () => notificationCalls,
			setPresence: (visibility, focus) => {
				presence.visibility = visibility;
				presence.focus = focus;
			},
			send: (message) => {
				const data = JSON.stringify(message);
				for (const socket of sockets) {
					if (socket.readyState === OriginalWebSocket.OPEN) socket.dispatchEvent(new MessageEvent("message", { data }));
				}
			},
			closeSockets: () => {
				for (const socket of sockets) {
					if (socket.readyState === OriginalWebSocket.OPEN) socket.close();
				}
			},
			openSockets: () => sockets.filter((socket) => socket.readyState === OriginalWebSocket.OPEN).length,
		};
	});

	page = await context.newPage();
	await page.goto(fixture.url);
	await dismissSetup(page);
	await page.locator(".astra-header").waitFor();
	assert.equal(await totalCalls(), 0, "initial ready/snapshot traffic does not notify");

	// A focused, visible page must swallow the edge-triggered event and must not
	// turn it into the app's separate in-page notice/toast UI.
	await page.evaluate(() => window.__notificationTest.setPresence("visible", true));
	await page.evaluate((message) => window.__notificationTest.send(message), event("focused-1", "run-completed"));
	await page.waitForTimeout(300);
	assert.equal(await totalCalls(), 0, "focused visible page does not deliver");
	assert.equal(await page.locator(".notices .notice").count(), 0, "focused event creates no in-page toast");

	// Hidden and unfocused states are both valid delivery states.
	await page.evaluate(() => window.__notificationTest.setPresence("hidden", true));
	await page.evaluate((message) => window.__notificationTest.send(message), event("hidden-1", "run-completed"));
	await eventually(async () => (await totalCalls()) === 1, "hidden event delivery");
	let delivered = await calls(page);
	assert.equal(delivered[0].title, "Task finished");
	assert.equal(delivered[0].options.body, "Dispatch project · Synthetic session · completed");

	await page.evaluate(() => window.__notificationTest.setPresence("visible", false));
	await page.evaluate((message) => window.__notificationTest.send(message), event("unfocused-1", "input-required"));
	await eventually(async () => (await totalCalls()) === 2, "unfocused event delivery");
	delivered = await calls(page);
	assert.equal(delivered[1].title, "Needs your input");
	assert.equal(delivered[1].options.body, "Dispatch project · Synthetic session · waiting for input");

	// The copy is deliberately limited to project/session/status fields, not raw
	// provider errors, prompts, or other event payloads.
	const privacyEvent = event("privacy-1", "run-failed");
	privacyEvent.rawError = "provider secret: do-not-display";
	privacyEvent.prompt = "private prompt: do-not-display";
	await page.evaluate(() => window.__notificationTest.setPresence("hidden", true));
	await page.evaluate((message) => window.__notificationTest.send(message), privacyEvent);
	await eventually(async () => (await totalCalls()) === 3, "failed event delivery");
	delivered = await calls(page);
	assert.equal(delivered[2].title, "Task failed");
	assert.equal(delivered[2].options.body, "Dispatch project · Synthetic session · failed");
	assert.doesNotMatch(JSON.stringify(delivered[2]), /do-not-display|provider secret|private prompt/);

	// A second real page shares the origin's localStorage and Web Locks. Sending
	// the same server event to both tabs concurrently must produce one delivery.
	second = await context.newPage();
	await second.goto(fixture.url);
	await dismissSetup(second);
	await second.locator(".astra-header").waitFor();
	await page.evaluate(() => window.__notificationTest.setPresence("hidden", true));
	await second.evaluate(() => window.__notificationTest.setPresence("hidden", true));
	const duplicate = event("duplicate-1", "run-failed");
	await Promise.all([
		page.evaluate((message) => window.__notificationTest.send(message), duplicate),
		second.evaluate((message) => window.__notificationTest.send(message), duplicate),
	]);
	await eventually(async () => (await totalCalls()) === 4, "one cross-tab delivery", 5000);
	assert.equal((await calls(page)).length + (await calls(second)).length, 4);
	assert.equal(
		(await calls(page)).filter((call) => call.title === "Task failed").length +
			(await calls(second)).filter((call) => call.title === "Task failed").length,
		2,
		"failed event delivered once for privacyEvent and once for duplicate event",
	);

	// Reconnects and ordinary snapshots are state reconciliation, not live event
	// edges. Closing both real sockets exercises the compiled reconnect path.
	await page.evaluate(() => window.__notificationTest.setPresence("visible", true));
	await second.evaluate(() => window.__notificationTest.setPresence("visible", true));
	await page.evaluate(() => window.__notificationTest.closeSockets());
	await second.evaluate(() => window.__notificationTest.closeSockets());
	await eventually(
		async () =>
			(await page.evaluate(() => window.__notificationTest.openSockets())) > 0 &&
			(await second.evaluate(() => window.__notificationTest.openSockets())) > 0,
		"both pages reconnect",
		10000,
	);
	assert.equal(await totalCalls(), 4, "reconnect snapshots do not notify");

	// The user-facing test control remains visible in Settings → Conversation.
	await page.getByRole("button", { name: "Settings", exact: true }).first().click();
	await page.getByRole("button", { name: "Conversation", exact: true }).click();
	const testButton = page.getByRole("button", { name: "Send test notification", exact: true });
	await testButton.waitFor({ state: "visible" });
	assert.equal(await testButton.isVisible(), true, "settings exposes the notification test button");

	console.log("notification browser checks passed");
} catch (error) {
	await page?.screenshot({ path: join(artifactDir, "notifications-failure.png") }).catch(() => {});
	if (fixture) console.error(fixture.serverLog());
	throw error;
} finally {
	await context?.close().catch(() => {});
	await fixture?.close().catch(() => {});
	if (previousPkgRoot === undefined) delete process.env.PI_WEB_PKG_ROOT;
	else process.env.PI_WEB_PKG_ROOT = previousPkgRoot;
	rmSync(base, { recursive: true, force: true });
}
