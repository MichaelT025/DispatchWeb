import { describe, expect, it } from "vitest";
import { ConversationStatuses } from "../../server/webui-context.js";

/**
 * Regression for the review-agent cross-chat status bug: the server used to
 * share ONE footer-status map across every conversation, so chat B's role
 * (e.g. "fast") overwrote chat A's ("review") and switching back to A showed
 * the wrong role while keeping A's tools. These tests exercise the pure
 * per-conversation store — no SDK runtime, no provider/model calls.
 */
describe("ConversationStatuses per-conversation scoping", () => {
	it("keeps two conversations' roles separate and suppresses background writes", () => {
		let active = "a";
		const store = new ConversationStatuses(() => active);

		// Chat A active → review role is emitted.
		expect(store.set("a", "piastra-agent", "Agent: review")).toEqual([
			{ key: "piastra-agent", text: "Agent: review" },
		]);

		// Chat B (background) → fast role is recorded but NOT emitted.
		expect(store.set("b", "piastra-agent", "Agent: fast")).toBeNull();

		// The active footer still shows A's role.
		expect(store.activeSnapshot()).toEqual([{ key: "piastra-agent", text: "Agent: review" }]);
		expect(store.snapshot("b")).toEqual([{ key: "piastra-agent", text: "Agent: fast" }]);
	});

	it("replays the switched-to conversation's role on switch (A review → B fast → A review)", () => {
		let active = "a";
		const store = new ConversationStatuses(() => active);

		store.set("a", "piastra-agent", "Agent: review");
		store.set("b", "piastra-agent", "Agent: fast");

		// Switch A → B: replay B's own role (the switch path pushes activeSnapshot()).
		active = "b";
		expect(store.activeSnapshot()).toEqual([{ key: "piastra-agent", text: "Agent: fast" }]);

		// Switch B → A: A's role is restored, not B's leftover.
		active = "a";
		expect(store.activeSnapshot()).toEqual([{ key: "piastra-agent", text: "Agent: review" }]);
	});

	it("reconnect replay returns the active conversation's role (no provider calls)", () => {
		let active = "b";
		const store = new ConversationStatuses(() => active);

		store.set("a", "piastra-agent", "Agent: review");
		store.set("b", "piastra-agent", "Agent: fast");

		// attachSink replays via activeSnapshot(): a fresh socket sees B's role.
		expect(store.activeSnapshot()).toEqual([{ key: "piastra-agent", text: "Agent: fast" }]);
	});

	it("clears a key on empty/undefined text and drops disposed conversations", () => {
		let active = "a";
		const store = new ConversationStatuses(() => active);

		store.set("a", "piastra-agent", "Agent: review");
		expect(store.activeSnapshot()).toHaveLength(1);

		// Empty and undefined both clear the entry.
		store.set("a", "piastra-agent", "");
		expect(store.activeSnapshot()).toEqual([]);
		store.set("a", "piastra-agent", "Agent: review");
		store.set("a", "piastra-agent", undefined);
		expect(store.activeSnapshot()).toEqual([]);

		// remove() forgets a conversation entirely.
		store.set("a", "piastra-agent", "Agent: review");
		store.remove("a");
		expect(store.snapshot("a")).toEqual([]);
		expect(store.activeSnapshot()).toEqual([]);
	});
});
