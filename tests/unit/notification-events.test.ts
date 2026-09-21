import { describe, expect, it } from "vitest";
import {
	formatNotificationEvent,
	isNotificationEvent,
	notificationConversationIdFromUrl,
	notificationEventKey,
	resolveNotificationConversation,
	withoutNotificationConversationId,
	type NotificationEvent,
} from "../../web/src/notification-events";

const event = (overrides: Partial<NotificationEvent> = {}): NotificationEvent => ({
	type: "notification_event",
	eventId: "event-42",
	conversationId: "conversation-a",
	kind: "run-completed",
	projectName: "dispatch-web",
	sessionName: "feature-notifications",
	...overrides,
});

describe("live notification events", () => {
	it("accepts only the live event shape, not snapshots or reconnect state", () => {
		expect(isNotificationEvent(event())).toBe(true);
		expect(isNotificationEvent({ type: "snapshot", state: {} })).toBe(false);
		expect(isNotificationEvent({ type: "conversations", conversations: [] })).toBe(false);
		expect(isNotificationEvent({ ...event(), kind: "unknown" })).toBe(false);
	});

	it("uses the server event ID unchanged for cross-tab deduplication", () => {
		const first = event({ eventId: "stable-1", conversationId: "conversation-a" });
		const second = event({ eventId: "stable-2", conversationId: "conversation-b" });
		expect(notificationEventKey(first)).toBe("stable-1");
		expect(notificationEventKey(first)).toBe(notificationEventKey(first));
		expect(notificationEventKey(first)).not.toBe(notificationEventKey(second));
	});

	it("formats project, session, and status only", () => {
		const copy = formatNotificationEvent(
			event({
				kind: "run-failed",
				projectName: "safe-project",
				sessionName: "release-session",
				// Extra wire data must not become notification content.
				prompt: "do not leak this prompt",
				error: "raw secret error",
			} as NotificationEvent & { prompt: string; error: string }),
		);
		expect(copy.title).toBe("Task failed");
		expect(copy.body).toContain("safe-project");
		expect(copy.body).toContain("release-session");
		expect(copy.body).toContain("failed");
		expect(copy.body).not.toContain("do not leak");
		expect(copy.body).not.toContain("raw secret");
	});

	it("keeps conversations scoped to the clicked ID and validates before switching", () => {
		const url = "https://example.test/pi/?token=t&notificationConversationId=conversation-b";
		expect(notificationConversationIdFromUrl(url)).toBe("conversation-b");
		expect(resolveNotificationConversation(url, ["conversation-a", "conversation-b"])).toBe("conversation-b");
		expect(resolveNotificationConversation(url, ["conversation-a"])).toBeNull();
		expect(withoutNotificationConversationId(url)).toBe("https://example.test/pi/?token=t");
	});
});
