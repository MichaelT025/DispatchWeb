import { describe, expect, it } from "vitest";
import { makeInputRequiredNotification, NotificationLifecycle } from "../../server/notification-lifecycle.js";

const context = (over: Partial<Parameters<NotificationLifecycle["settled"]>[0]> = {}) => ({
	conversationId: "conv-1",
	projectName: "dispatch",
	isIdle: true,
	...over,
});

function lifecycle() {
	let n = 0;
	return new NotificationLifecycle({ newEventId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
}

describe("authoritative notification lifecycle", () => {
	it("emits one completed event only at an idle settled run", () => {
		const state = lifecycle();
		state.agentStart();
		state.agentEnd([{ role: "assistant", stopReason: "stop" }]);
		expect(state.settled(context({ isIdle: false }))).toBeNull();
		const event = state.settled(context());
		expect(event).toMatchObject({ type: "notification_event", kind: "run-completed", conversationId: "conv-1" });
		expect(state.settled(context())).toBeNull();
	});

	it("does not settle while a retry or queued continuation remains", () => {
		const state = lifecycle();
		state.agentStart();
		state.agentEnd([{ role: "assistant", stopReason: "error" }]);
		expect(state.settled(context({ retrying: true }))).toBeNull();
		expect(state.settled(context({ queuedFollowUp: ["continue"] }))).toBeNull();
		state.agentStart();
		state.agentEnd([{ role: "assistant", stopReason: "stop" }]);
		expect(state.settled(context())).toMatchObject({ kind: "run-completed" });
	});

	it("reports final errors, but aborts never notify", () => {
		const failed = lifecycle();
		failed.agentStart();
		failed.agentEnd([{ role: "assistant", stopReason: "error" }]);
		expect(failed.settled(context())).toMatchObject({ kind: "run-failed" });

		const aborted = lifecycle();
		aborted.agentStart();
		aborted.agentEnd([{ role: "assistant", stopReason: "aborted" }]);
		expect(aborted.settled(context())).toBeNull();
	});

	it("guards worker activity and ignores worker terminal callbacks until settlement", () => {
		const state = lifecycle();
		state.agentStart();
		state.agentEnd([{ role: "assistant", stopReason: "stop" }]);
		expect(state.settled(context({ workers: [{ status: "running" }] }))).toBeNull();
		expect(state.settled(context({ workers: [{ status: "completed" }] }))).toMatchObject({
			kind: "run-completed",
		});
	});

	it("resets on session replacement and never replays an input event", () => {
		const state = lifecycle();
		state.agentStart();
		state.reset();
		expect(state.settled(context())).toBeNull();
		const event = makeInputRequiredNotification(
			{ conversationId: "background-conv", projectName: "other", sessionName: "named" },
			() => "00000000-0000-4000-8000-000000000001",
		);
		expect(event).toEqual({
			type: "notification_event",
			eventId: "00000000-0000-4000-8000-000000000001",
			conversationId: "background-conv",
			kind: "input-required",
			projectName: "other",
			sessionName: "named",
		});
		expect(JSON.stringify(event)).not.toMatch(/question|prompt|error|detail/i);
	});
});
