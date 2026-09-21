// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../web/src/i18n.js";
import { NotifyToggle } from "../../web/src/components/NotifyToggle.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
	loadNotifySettings: vi.fn(),
	saveNotifySettings: vi.fn(),
	notifyBlockReason: vi.fn(),
	notificationPermission: vi.fn(),
	requestNotificationPermission: vi.fn(),
	sendTestNotification: vi.fn(),
	isWindowsPlatform: vi.fn(),
}));

vi.mock("../../web/src/notify.js", () => mocks);

type Settings = { enabled: boolean };

let currentSettings: Settings;
let root: Root | null = null;
let container: HTMLDivElement;

function mount(strict = false) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const toggle = createElement(NotifyToggle);
	const tree = strict ? createElement(StrictMode, null, toggle) : toggle;
	act(() => root!.render(createElement(LanguageProvider, null, tree)));
	return container;
}

function checkbox() {
	return container.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

function testButton() {
	return container.querySelector(".sound-preview") as HTMLButtonElement;
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

beforeEach(() => {
	currentSettings = { enabled: false };
	mocks.loadNotifySettings.mockImplementation(() => ({ ...currentSettings }));
	mocks.saveNotifySettings.mockImplementation((next: Settings) => {
		currentSettings = { ...next };
	});
	mocks.notifyBlockReason.mockReturnValue(null);
	mocks.notificationPermission.mockReturnValue("default");
	mocks.requestNotificationPermission.mockResolvedValue("granted");
	mocks.sendTestNotification.mockResolvedValue({
		path: "page",
		suppressed: false,
		permission: "granted",
		supported: true,
		secureContext: true,
		serviceWorker: false,
		held: null,
		presence: { hasFocus: false, visibility: "hidden", minimized: false, idleMs: 0, windows: false },
	});
	mocks.isWindowsPlatform.mockReturnValue(false);
});

afterEach(() => {
	vi.useRealTimers();
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
	vi.clearAllMocks();
});

describe("NotifyToggle settings regressions", () => {
	it("handles permission grants and denials under StrictMode", async () => {
		mount(true);
		act(() => checkbox().click());
		await flush();
		expect(checkbox().checked).toBe(true);
		expect(currentSettings.enabled).toBe(true);

		act(() => root!.unmount());
		root = null;
		currentSettings = { enabled: false };
		mocks.loadNotifySettings.mockImplementation(() => ({ ...currentSettings }));
		mocks.requestNotificationPermission.mockResolvedValue("denied");
		mount(true);
		act(() => checkbox().click());
		await flush();
		expect(checkbox().checked).toBe(false);
		expect(currentSettings.enabled).toBe(false);
	});

	it("waits five seconds before sending the visible test notification", async () => {
		vi.useFakeTimers();
		mount();
		act(() => testButton().click());
		await flush();
		expect(testButton().disabled).toBe(true);
		expect(mocks.sendTestNotification).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(4999);
		});
		expect(mocks.sendTestNotification).not.toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(1);
			await Promise.resolve();
		});
		expect(mocks.sendTestNotification).toHaveBeenCalledTimes(1);
	});

	it("keeps an explicit off choice after a pending permission resolves", async () => {
		let resolvePermission!: (permission: NotificationPermission) => void;
		mocks.requestNotificationPermission.mockReturnValue(new Promise((resolve) => (resolvePermission = resolve)));
		mount();
		act(() => checkbox().click());
		act(() => checkbox().click());
		expect(checkbox().checked).toBe(false);
		resolvePermission("granted");
		await flush();
		expect(checkbox().checked).toBe(false);
		expect(currentSettings.enabled).toBe(false);
	});

	it("does not save or schedule a choice when unmounted during permission", async () => {
		let resolvePermission!: (permission: NotificationPermission) => void;
		mocks.requestNotificationPermission.mockReturnValue(new Promise((resolve) => (resolvePermission = resolve)));
		vi.useFakeTimers();
		mount();
		act(() => checkbox().click());
		act(() => root!.unmount());
		root = null;
		resolvePermission("granted");
		await flush();
		vi.advanceTimersByTime(5000);
		expect(mocks.saveNotifySettings).not.toHaveBeenCalledWith({ enabled: true });
		expect(mocks.sendTestNotification).not.toHaveBeenCalled();
	});

	it("cancels a scheduled test when unmounted", async () => {
		vi.useFakeTimers();
		mount();
		act(() => testButton().click());
		await flush();
		act(() => root!.unmount());
		root = null;
		vi.advanceTimersByTime(5000);
		expect(mocks.sendTestNotification).not.toHaveBeenCalled();
	});

	it("clears pending after the test notification API rejects", async () => {
		vi.useFakeTimers();
		mocks.sendTestNotification.mockRejectedValue(new Error("notification failed"));
		mount();
		act(() => testButton().click());
		await flush();
		await act(async () => {
			vi.advanceTimersByTime(5000);
			await Promise.resolve();
		});
		expect(testButton().disabled).toBe(false);
	});

	it("syncs preference changes from another tab", () => {
		mount();
		expect(checkbox().checked).toBe(false);
		currentSettings = { enabled: true };
		act(() => window.dispatchEvent(new StorageEvent("storage", { key: "pi-web-notify" })));
		expect(checkbox().checked).toBe(true);
		currentSettings = { enabled: false };
		act(() => window.dispatchEvent(new StorageEvent("storage", { key: "pi-web-notify" })));
		expect(checkbox().checked).toBe(false);
	});
});
