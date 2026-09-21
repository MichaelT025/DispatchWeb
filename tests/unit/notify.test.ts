import { afterEach, describe, expect, it } from "vitest";
import {
	idleSinceLastActivityMs,
	isCollapsedWindow,
	isWindowsPlatform,
	markActivity,
	notify,
	notifyBlockReason,
	notificationsSupported,
	NOTIFY_EVENT_LEDGER_MAX_ENTRIES,
	NOTIFY_EVENT_LEDGER_TTL_MS,
	NOTIFY_EVENT_LOCK_NAME,
	NOTIFY_IDLE_GRACE_MS,
	sendTestNotification,
	shouldDeliverNotify,
	shouldSuppressNotify,
	type PresenceSignals,
} from "../../web/src/notify.js";

const presence = (patch: Partial<PresenceSignals> = {}): PresenceSignals => ({
	hasFocus: true,
	visibility: "visible",
	minimized: false,
	idleMs: 0,
	windows: false,
	...patch,
});

describe("window presence diagnostics", () => {
	it("recognises measured minimised rectangles, without using them as a delivery exception", () => {
		expect(isCollapsedWindow({ screenX: -21334, screenY: -21333, outerWidth: 108, outerHeight: 20 })).toBe(true);
		expect(isCollapsedWindow({ screenX: -32000, screenY: -32000, outerWidth: 160, outerHeight: 28 })).toBe(true);
		expect(isCollapsedWindow({ screenX: -5760, screenY: 0, outerWidth: 1296, outerHeight: 808 })).toBe(false);
		expect(isCollapsedWindow({ screenX: 0, screenY: -2160, outerWidth: 1296, outerHeight: 808 })).toBe(false);
		expect(isCollapsedWindow({ screenX: NaN, screenY: NaN, outerWidth: 600, outerHeight: 400 })).toBe(false);
		expect(isCollapsedWindow({ screenX: 0, screenY: 0, outerWidth: 0, outerHeight: 0 })).toBe(false);
	});

	it("uses only hidden visibility OR lost focus", () => {
		expect(shouldDeliverNotify(presence({ visibility: "hidden" }))).toBe(true);
		expect(shouldDeliverNotify(presence({ hasFocus: false }))).toBe(true);
		expect(shouldDeliverNotify(presence({ minimized: true, windows: true, idleMs: NOTIFY_IDLE_GRACE_MS + 1 }))).toBe(
			false,
		);
		expect(shouldDeliverNotify(presence({ visibility: "prerender" }))).toBe(false);
		expect(shouldSuppressNotify(presence())).toBe(true);
		expect(shouldSuppressNotify(presence({ visibility: "hidden", hasFocus: true }))).toBe(false);
	});
});

describe("activity diagnostics", () => {
	it("markActivity resets the diagnostic idle timer, which is not a delivery heuristic", () => {
		markActivity();
		expect(idleSinceLastActivityMs()).toBeLessThan(200);
	});
});

describe("unsupported environments", () => {
	it("reports unsupported without a browser window", () => {
		expect(notificationsSupported()).toBe(false);
		expect(notifyBlockReason()).toBe("unsupported");
	});
});

describe("isWindowsPlatform", () => {
	it("does not misreport the node test environment", () => {
		expect(isWindowsPlatform()).toBe(false);
	});
});

type Shown = {
	title: string;
	options: NotificationOptions;
	instance: { onclick?: (() => void) | null; closed: boolean };
};
type BrowserSetup = {
	visibility?: DocumentVisibilityState;
	focus?: boolean;
	permission?: NotificationPermission;
	locks?: { request: (name: string, callback: () => Promise<unknown>) => Promise<unknown> };
	storage?: Storage;
	getRegistration?: () => Promise<ServiceWorkerRegistration | undefined>;
};

const original = new Map<string, PropertyDescriptor | undefined>();
const browserGlobals = ["window", "document", "navigator", "Notification", "localStorage", "location"];
for (const key of browserGlobals) original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

function installBrowser(setup: BrowserSetup = {}): { shown: Shown[]; storage: Storage } {
	const shown: Shown[] = [];
	class FakeNotification {
		static permission: NotificationPermission = setup.permission ?? "granted";
		onclick: (() => void) | null = null;
		closed = false;
		constructor(title: string, options: NotificationOptions) {
			shown.push({ title, options, instance: this });
		}
		close() {
			this.closed = true;
		}
	}
	const memory = new Map<string, string>();
	const storage =
		setup.storage ??
		({
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => void memory.set(key, value),
			removeItem: (key: string) => void memory.delete(key),
			clear: () => memory.clear(),
			key: (index: number) => [...memory.keys()][index] ?? null,
			length: 0,
		} as Storage);
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			Notification: FakeNotification,
			isSecureContext: true,
			focus: () => undefined,
			location: { href: "https://example.test/chat", assign: () => undefined },
			screenX: 10,
			screenY: 10,
			outerWidth: 1200,
			outerHeight: 800,
			addEventListener: () => undefined,
		},
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			visibilityState: setup.visibility ?? "hidden",
			hasFocus: () => setup.focus ?? false,
			addEventListener: () => undefined,
		},
	});
	Object.defineProperty(globalThis, "Notification", { configurable: true, value: FakeNotification });
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
	Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://example.test/chat" } });
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			userAgent: "test",
			locks: setup.locks,
			serviceWorker: { getRegistration: setup.getRegistration ?? (async () => undefined) },
		},
	});
	return { shown, storage };
}

afterEach(() => {
	for (const key of browserGlobals) {
		const descriptor = original.get(key);
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete (globalThis as Record<string, unknown>)[key];
	}
});

function enabledStorage(): Storage {
	const values = new Map<string, string>([["pi-web-notify", JSON.stringify({ enabled: true })]]);
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value),
		removeItem: (key) => void values.delete(key),
		clear: () => values.clear(),
		key: (index) => [...values.keys()][index] ?? null,
		length: values.size,
	};
}

function immediateLocks() {
	return { request: async (_name: string, callback: () => Promise<unknown>) => callback() };
}

describe("strict notification delivery", () => {
	it("keeps notifications opt-in and delivers hidden/unfocused pages only", async () => {
		const disabled = installBrowser({ visibility: "hidden", focus: true });
		await notify("opt-in");
		expect(disabled.shown).toHaveLength(0);

		const hidden = installBrowser({ visibility: "hidden", focus: true });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("hidden");
		expect(hidden.shown).toHaveLength(1);

		const focused = installBrowser({ visibility: "visible", focus: true });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("focused");
		expect(focused.shown).toHaveLength(0);

		const unfocused = installBrowser({ visibility: "visible", focus: false });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("unfocused");
		expect(unfocused.shown).toHaveLength(1);
	});

	it("fails closed for denied permission and unsupported APIs", async () => {
		const denied = installBrowser({ permission: "denied" });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("denied");
		expect(denied.shown).toHaveLength(0);

		const noBrowser = original.get("window");
		if (noBrowser) Object.defineProperty(globalThis, "window", noBrowser);
		else delete (globalThis as Record<string, unknown>).window;
		await notify("unsupported");
	});

	it("test notification also refuses foreground delivery with an instruction", async () => {
		installBrowser({ visibility: "visible", focus: true });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		const result = await sendTestNotification("test");
		expect(result.path).toBe("none");
		expect(result.suppressed).toBe(true);
		expect(result.error).toContain("switch away");
	});

	it("rechecks focus before the service-worker delivery", async () => {
		let focus = false;
		const browser = installBrowser({
			visibility: "hidden",
			focus: false,
			getRegistration: async () => {
				focus = true;
				return { active: { showNotification: async () => undefined } } as unknown as ServiceWorkerRegistration;
			},
		});
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { visibilityState: "visible", hasFocus: () => focus, addEventListener: () => undefined },
		});
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("race");
		expect(browser.shown).toHaveLength(0);
	});

	it("stops a pending delivery when settings are turned off while the SW is awaited", async () => {
		let resolveRegistration: (registration: ServiceWorkerRegistration | undefined) => void = () => undefined;
		const registration = new Promise<ServiceWorkerRegistration | undefined>((resolve) => {
			resolveRegistration = resolve;
		});
		const browser = installBrowser({ getRegistration: () => registration });
		const storage = enabledStorage();
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
		const pending = notify("pending");
		storage.setItem("pi-web-notify", JSON.stringify({ enabled: false }));
		resolveRegistration(undefined);
		await pending;
		expect(browser.shown).toHaveLength(0);
	});

	it("stops a keyed delivery when settings are turned off while the lock is awaited", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const locks = {
			request: async (_name: string, callback: () => Promise<unknown>) => {
				await gate;
				return callback();
			},
		};
		const browser = installBrowser({ locks });
		const storage = enabledStorage();
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
		const pending = notify("pending keyed", undefined, { eventKey: "pending-key" });
		storage.setItem("pi-web-notify", JSON.stringify({ enabled: false }));
		release();
		await pending;
		expect(browser.shown).toHaveLength(0);
	});

	it("uses the page fallback when the service worker route fails", async () => {
		const browser = installBrowser({
			getRegistration: async () =>
				({
					active: {
						showNotification: async () => {
							throw new Error("sw failed");
						},
					},
				}) as unknown as ServiceWorkerRegistration,
		});
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("fallback");
		expect(browser.shown).toHaveLength(1);
	});

	it("diagnostic tests respect the opt-in setting", async () => {
		installBrowser({ visibility: "hidden", focus: false });
		const result = await sendTestNotification("disabled test");
		expect(result.path).toBe("none");
		expect(result.error).toBe("notifications disabled");
	});

	it("page fallback clicks close, focus, and select without reloading a pending dialog", async () => {
		const browser = installBrowser({
			getRegistration: async () => ({ active: undefined }) as unknown as ServiceWorkerRegistration,
		});
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		const assigned: string[] = [];
		const win = globalThis.window as unknown as {
			focus: () => void;
			location: { assign: (url: string) => void };
			dispatchEvent: (event: Event) => boolean;
		};
		const clicks: CustomEvent[] = [];
		win.dispatchEvent = (event) => {
			clicks.push(event as CustomEvent);
			return true;
		};
		let focused = 0;
		win.focus = () => focused++;
		win.location.assign = (url: string) => assigned.push(url);
		await notify("click", undefined, { conversationId: "conversation-click" });
		browser.shown[0]?.instance.onclick?.();
		expect(browser.shown[0]?.instance.closed).toBe(true);
		expect(focused).toBe(1);
		expect(assigned).toEqual([]);
		expect(clicks[0]?.type).toBe("dispatch:notification-click");
		expect(clicks[0]?.detail).toEqual({ type: "notification-click", conversationId: "conversation-click" });
	});
});

describe("keyed cross-tab notification delivery", () => {
	it("uses one global lock and retains distinct concurrent event IDs", async () => {
		const names: string[] = [];
		const locks = {
			request: async (name: string, callback: () => Promise<unknown>) => {
				names.push(name);
				return callback();
			},
		};
		const storage = enabledStorage();
		const browser = installBrowser({ locks, storage });
		await Promise.all([
			notify("event a", undefined, { eventKey: "event-a" }),
			notify("event b", undefined, { eventKey: "event-b" }),
		]);
		expect(names).toEqual([NOTIFY_EVENT_LOCK_NAME, NOTIFY_EVENT_LOCK_NAME]);
		expect(browser.shown).toHaveLength(2);
		const ledger = JSON.parse(storage.getItem("pi-web-notify-consumed-events-v1") ?? "{}");
		expect(Object.keys(ledger)).toEqual(expect.arrayContaining(["event-a", "event-b"]));
	});

	it("expires old entries and bounds ledger size", async () => {
		const storage = enabledStorage();
		const old = Date.now() - NOTIFY_EVENT_LEDGER_TTL_MS - 1;
		const entries: Record<string, number> = { old };
		for (let i = 0; i < NOTIFY_EVENT_LEDGER_MAX_ENTRIES + 2; i++) entries[`existing-${i}`] = Date.now() - i;
		storage.setItem("pi-web-notify-consumed-events-v1", JSON.stringify(entries));
		installBrowser({ locks: immediateLocks(), storage });
		await notify("bounded", undefined, { eventKey: "new-event" });
		const compacted = JSON.parse(storage.getItem("pi-web-notify-consumed-events-v1") ?? "{}");
		expect(compacted.old).toBeUndefined();
		expect(Object.keys(compacted).length).toBeLessThanOrEqual(NOTIFY_EVENT_LEDGER_MAX_ENTRIES);
	});

	it("delivers a stable event once and carries the target conversation id", async () => {
		const browser = installBrowser({ locks: immediateLocks() });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("one", "body", { eventKey: "event-1", targetConversationId: "conversation-7" });
		await notify("duplicate", undefined, { eventKey: "event-1", targetConversationId: "conversation-7" });
		expect(browser.shown).toHaveLength(1);
		expect(browser.shown[0]?.options).toMatchObject({
			silent: true,
			data: { url: "https://example.test/chat", notificationConversationId: "conversation-7" },
		});
	});

	it("serializes concurrent tabs through the lock and consumes focused skips", async () => {
		let locked = false;
		const waiters: (() => void)[] = [];
		const locks = {
			request: async (_name: string, callback: () => Promise<unknown>) => {
				if (locked) await new Promise<void>((resolve) => waiters.push(resolve));
				locked = true;
				try {
					return await callback();
				} finally {
					locked = false;
					waiters.shift()?.();
				}
			},
		};
		const browser = installBrowser({ locks });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await Promise.all([
			notify("first", undefined, { eventKey: "concurrent" }),
			notify("second", undefined, { eventKey: "concurrent" }),
		]);
		expect(browser.shown).toHaveLength(1);

		const focused = installBrowser({
			visibility: "visible",
			focus: true,
			locks: immediateLocks(),
			storage: enabledStorage(),
		});
		await notify("skip", undefined, { eventKey: "focused-skip" });
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { visibilityState: "hidden", hasFocus: () => false, addEventListener: () => undefined },
		});
		await notify("replay", undefined, { eventKey: "focused-skip" });
		expect(focused.shown).toHaveLength(0);
	});

	it("fails closed when either safe coordination primitive is unavailable or storage fails", async () => {
		const noLocks = installBrowser();
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: enabledStorage() });
		await notify("no lock", undefined, { eventKey: "no-lock" });
		expect(noLocks.shown).toHaveLength(0);

		const brokenStorage = {
			getItem: () => {
				throw new Error("private mode");
			},
			setItem: () => undefined,
		} as unknown as Storage;
		const broken = installBrowser({ locks: immediateLocks(), storage: brokenStorage });
		await notify("broken storage", undefined, { eventKey: "storage-failure" });
		expect(broken.shown).toHaveLength(0);
	});
});
