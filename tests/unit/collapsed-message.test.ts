// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LanguageProvider } from "../../web/src/i18n.js";
import { CollapsedMessage } from "../../web/src/components/CollapsedMessage.js";
import { recentStartIndex } from "../../web/src/components/MessageList.js";
import type { UiMessage } from "../../web/src/types.js";

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(message: UiMessage) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			createElement(LanguageProvider, null, createElement(CollapsedMessage, { message, onExpand: () => {} })),
		);
	});
	return container;
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("CollapsedMessage", () => {
	it("shows one header-style line per block instead of count pills", () => {
		const container = mount({
			id: "a1",
			role: "assistant",
			timestamp: 1,
			content: [
				{
					type: "thinking",
					thinking:
						"**Checking provider auth lookup**\n\nThe lookup reads auth.json first.\nlong hidden body that must not render",
				},
				{ type: "toolCall", id: "c1", name: "read", argumentsText: '{"path":"src/app.ts"}' },
				{ type: "toolCall", id: "c2", name: "bash", argumentsText: '{"command":"npm test"}' },
				{ type: "text", text: "Found the bug in the auth lookup.\n\nMore prose below." },
			],
		} as UiMessage);
		const lines = [...container.querySelectorAll<HTMLElement>(".msg-collapsed-line, .msg-collapsed-preview")];
		expect(lines.map((l) => l.textContent)).toEqual([
			"Thinking: The lookup reads auth.json first.",
			"Readsrc/app.ts",
			"Rannpm test",
			"Found the bug in the auth lookup. More prose below.",
		]);
		expect(container.querySelector(".msg-collapsed-chip")).toBeNull();
		expect(container.textContent).not.toContain("tool calls");
		expect(container.textContent).not.toContain("long hidden body");
		// icons: thinking cpu + one per tool
		expect(container.querySelectorAll(".msg-collapsed-line svg")).toHaveLength(3);
	});

	it("caps very long turns and says how many more", () => {
		const container = mount({
			id: "a2",
			role: "assistant",
			timestamp: 1,
			content: Array.from({ length: 9 }, (_, i) => ({
				type: "toolCall",
				id: `c${i}`,
				name: "read",
				argumentsText: `{"path":"f${i}.ts"}`,
			})),
		} as UiMessage);
		expect(container.querySelectorAll(".msg-collapsed-line")).toHaveLength(6);
		expect(container.querySelector(".msg-collapsed-more")?.textContent).toBe("+3 more");
	});
});

describe("recentStartIndex", () => {
	const msg = (role: string) => ({ role });
	it("counts visible messages only, so tool results do not eat the window", () => {
		// 40 assistant tool-call turns, each followed by its toolResult record
		const messages = Array.from({ length: 80 }, (_, i) => msg(i % 2 === 0 ? "assistant" : "toolResult"));
		const start = recentStartIndex(messages, 15, 30);
		// 15 visible messages remain fully rendered → the last 15 assistant
		// records, i.e. index 80 - 2*15 = 50
		expect(start).toBe(50);
		expect(messages.slice(start).filter((m) => m.role !== "toolResult")).toHaveLength(15);
	});
	it("does nothing for short chats", () => {
		const messages = Array.from({ length: 60 }, (_, i) => msg(i % 2 === 0 ? "assistant" : "toolResult"));
		expect(recentStartIndex(messages, 15, 30)).toBe(0);
	});
});
