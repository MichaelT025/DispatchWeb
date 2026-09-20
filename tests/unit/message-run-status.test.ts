// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Message } from "../../web/src/components/Message.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { UiMessage } from "../../web/src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function assistant(over: Partial<UiMessage> = {}): UiMessage {
	return {
		id: "assistant-1",
		role: "assistant",
		content: [],
		...over,
	};
}

function mount(message: UiMessage, over: Partial<React.ComponentProps<typeof Message>> = {}) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() =>
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(Message, {
					message,
					toolResults: new Map(),
					liveOutputs: new Map(),
					toolStatuses: new Map(),
					streaming: false,
					isLast: true,
					...over,
				}),
			),
		),
	);
	return container;
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("assistant run status", () => {
	it("renders canceled run after partial output without error chrome or retry", () => {
		const onRetry = vi.fn();
		const container = mount(
			assistant({
				stopReason: "aborted",
				errorMessage: "Request was aborted",
				content: [{ type: "text", text: "Partial answer" }],
			}),
			{ onRetry },
		);

		expect(container.textContent).toContain("Partial answer");
		expect(container.querySelector(".msg-run-status-canceled")?.textContent).toBe("Canceled run");
		expect(container.querySelector(".msg-error")).toBeNull();
		expect(container.querySelector(".msg-retry-btn")).toBeNull();
		expect(container.querySelector(".thinking-wait")).toBeNull();
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("renders canceled run even when an aborted message has no error", () => {
		const container = mount(assistant({ stopReason: "aborted" }));

		expect(container.querySelector(".msg-run-status-canceled")?.textContent).toBe("Canceled run");
		expect(container.querySelector(".msg-error")).toBeNull();
	});

	it("recognizes only the narrow legacy abort error when stopReason is absent", () => {
		const legacy = mount(assistant({ errorMessage: "Request was aborted" }));
		expect(legacy.querySelector(".msg-run-status-canceled")).not.toBeNull();
		act(() => root!.unmount());
		root = null;
		legacy.remove();

		const realError = mount(assistant({ stopReason: "error", errorMessage: "Request was aborted" }), {
			onRetry: vi.fn(),
		});
		expect(realError.querySelector(".msg-error")?.textContent).toContain("Request was aborted");
		expect(realError.querySelector(".msg-run-status-canceled")).toBeNull();
		expect(realError.querySelector(".msg-retry-btn")).not.toBeNull();
	});

	it("keeps a genuine error and its retry link", () => {
		const onRetry = vi.fn();
		const container = mount(assistant({ stopReason: "error", errorMessage: "Upstream failed" }), { onRetry });
		const retry = container.querySelector(".msg-retry-btn") as HTMLButtonElement;

		expect(container.querySelector(".msg-error")?.textContent).toContain("Upstream failed");
		expect(retry.textContent).toBe("Retry");
		act(() => retry.click());
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("does not show run status for a successful assistant message", () => {
		const container = mount(assistant({ stopReason: "stop", content: [{ type: "text", text: "Done" }] }));

		expect(container.textContent).toContain("Done");
		expect(container.querySelector(".msg-run-status")).toBeNull();
		expect(container.querySelector(".msg-error")).toBeNull();
	});
});
