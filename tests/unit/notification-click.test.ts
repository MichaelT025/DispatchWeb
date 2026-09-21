import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
	NOTIFICATION_CLICK_EVENT,
	notificationClickMessage,
	parseNotificationClickMessage,
} from "../../web/src/notification-events";

describe("notification click routing contract", () => {
	it("uses one strict payload for service-worker and page fallback clicks", () => {
		const message = notificationClickMessage("conversation-b");
		expect(message).toEqual({ type: "notification-click", conversationId: "conversation-b" });
		expect(parseNotificationClickMessage(message)).toBe("conversation-b");
		expect(parseNotificationClickMessage({ type: "notification-click", conversationId: "" })).toBeNull();
		expect(parseNotificationClickMessage({ type: "other", conversationId: "conversation-b" })).toBeNull();
		expect(parseNotificationClickMessage({ conversationId: "conversation-b" })).toBeNull();
		expect(
			parseNotificationClickMessage({ type: "notification-click", conversationId: "conversation-b", url: "/" }),
		).toBeNull();
	});

	it("preserves a pending dialog when an existing tab receives a click", async () => {
		const pendingDialog = { id: 17, kind: "input", title: "Still answerable", args: [] };
		const page = { dialog: pendingDialog };
		const client = {
			url: "https://example.test/pi/",
			postMessage: vi.fn((message: unknown) => {
				// This is the App listener's in-place route: it does not reload the
				// page, so blocking extension UI remains mounted and answerable.
				expect(parseNotificationClickMessage(message)).toBe("conversation-b");
			}),
			focus: vi.fn(async () => client),
			navigate: vi.fn(() => {
				throw new Error("existing clients must never navigate on notification click");
			}),
		};
		const listeners = new Map<string, (event: unknown) => void>();
		const openWindow = vi.fn();
		runInNewContext(readFileSync(new URL("../../web/public/sw.js", import.meta.url), "utf8"), {
			URL,
			self: {
				registration: { scope: "https://example.test/pi/" },
				location: { origin: "https://example.test" },
				addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler),
				clients: { matchAll: async () => [client], openWindow },
			},
		});
		let completion: Promise<unknown> | undefined;
		const close = vi.fn();
		listeners.get("notificationclick")!({
			notification: { close, data: { url: client.url, notificationConversationId: "conversation-b" } },
			waitUntil: (promise: Promise<unknown>) => {
				completion = promise;
			},
		});
		await completion;
		expect(close).toHaveBeenCalledOnce();
		expect(openWindow).not.toHaveBeenCalled();

		expect(client.postMessage).toHaveBeenCalledTimes(1);
		expect(client.focus).toHaveBeenCalledTimes(1);
		expect(client.navigate).not.toHaveBeenCalled();
		expect(page.dialog).toBe(pendingDialog);
		expect(NOTIFICATION_CLICK_EVENT).toBe("dispatch:notification-click");
	});
});
