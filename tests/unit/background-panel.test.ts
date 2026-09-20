// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { BackgroundPanel } from "../../web/src/components/BackgroundPanel.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { BgServer, ClientMessage } from "../../web/src/types.js";

let root: Root | null = null;

function mount(servers: BgServer[], send = vi.fn((_message: ClientMessage) => true)) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const render = (nextServers: BgServer[]) => {
		act(() => {
			root!.render(
				createElement(LanguageProvider, null, createElement(BackgroundPanel, { servers: nextServers, send })),
			);
		});
	};
	render(servers);
	return { container, send, render };
}

function messagesOf(send: ReturnType<typeof vi.fn>, type: ClientMessage["type"]) {
	return send.mock.calls.map(([message]) => message).filter((message) => message.type === type);
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("BackgroundPanel", () => {
	it("requests the background-server list when mounted", () => {
		const { send } = mount([]);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith({ type: "list_bg_servers" });
	});

	it("renders the empty state when no servers are tracked", () => {
		const { container } = mount([]);

		expect(container.querySelector(".background-empty")?.textContent).toContain("No background tasks");
		expect(container.querySelector(".background-list")).toBeNull();
	});

	it("renders server metadata and its command", () => {
		const { container } = mount([
			{
				port: 4173,
				pid: 9021,
				since: Date.now() - 2 * 60_000,
				name: "vite",
				command: "npm run dev -- --host 127.0.0.1",
			},
		]);

		const row = container.querySelector(".background-row") as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.textContent).toContain("vite");
		expect(row.textContent).toContain("Port 4173");
		expect(row.textContent).toContain("PID 9021");
		expect(row.textContent).toContain("Started 2 min ago");
		expect(row.querySelector(".background-command")?.textContent).toBe("npm run dev -- --host 127.0.0.1");
	});

	it("refreshes the server list when Refresh is clicked", () => {
		const { container, send } = mount([]);
		const refresh = container.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;

		act(() => refresh.click());

		expect(messagesOf(send, "list_bg_servers")).toHaveLength(2);
	});

	it("requires confirmation for a single stop and cancellation sends no kill", () => {
		const { container, send } = mount([{ port: 3000, since: Date.now(), name: "node" }]);
		const stop = container.querySelector('button[aria-label="Stop: node"]') as HTMLButtonElement;
		stop.focus();

		act(() => stop.click());
		expect(messagesOf(send, "kill_background_server")).toHaveLength(0);
		expect(container.querySelector(".background-confirm")).not.toBeNull();
		expect(document.activeElement).toBe(container.querySelector(".background-confirm-cancel"));

		const cancel = container.querySelector(".background-confirm-cancel") as HTMLButtonElement;
		act(() => cancel.click());
		expect(messagesOf(send, "kill_background_server")).toHaveLength(0);
		expect(container.querySelector('button[aria-label="Stop: node"]')).not.toBeNull();
		expect(document.activeElement).toBe(container.querySelector('button[aria-label="Stop: node"]'));

		act(() => (container.querySelector('button[aria-label="Stop: node"]') as HTMLButtonElement).click());
		act(() => (container.querySelector(".background-confirm-stop") as HTMLButtonElement).click());
		expect(send).toHaveBeenLastCalledWith({ type: "kill_background_server", port: 3000 });
		expect(document.activeElement).toBe(container.querySelector('button[aria-label="Refresh"]'));
	});

	it("focuses refresh when a confirming server disappears", () => {
		const { container, render } = mount([{ port: 3000, since: Date.now(), name: "node" }]);
		const stop = container.querySelector('button[aria-label="Stop: node"]') as HTMLButtonElement;
		stop.focus();

		act(() => stop.click());
		expect(document.activeElement).toBe(container.querySelector(".background-confirm-cancel"));

		render([]);

		expect(container.querySelector(".background-confirm")).toBeNull();
		expect(document.activeElement).toBe(container.querySelector('button[aria-label="Refresh"]'));
	});

	it("requires confirmation for stopping all and cancellation sends no kill", () => {
		const { container, send } = mount([
			{ port: 3000, since: Date.now(), name: "node" },
			{ port: 4000, since: Date.now(), name: "vite" },
		]);
		const stopAll = container.querySelector(".background-stop-all") as HTMLButtonElement;
		stopAll.focus();

		act(() => stopAll.click());
		expect(messagesOf(send, "kill_background_servers")).toHaveLength(0);
		expect(container.querySelector(".background-confirm")).not.toBeNull();
		expect(document.activeElement).toBe(container.querySelector(".background-confirm-cancel"));

		const cancel = container.querySelector(".background-confirm-cancel") as HTMLButtonElement;
		act(() => cancel.click());
		expect(messagesOf(send, "kill_background_servers")).toHaveLength(0);
		expect(container.querySelector(".background-stop-all")).not.toBeNull();
		expect(document.activeElement).toBe(container.querySelector(".background-stop-all"));

		act(() => (container.querySelector(".background-stop-all") as HTMLButtonElement).click());
		act(() => (container.querySelector(".background-confirm-stop") as HTMLButtonElement).click());
		expect(send).toHaveBeenLastCalledWith({ type: "kill_background_servers" });
		expect(document.activeElement).toBe(container.querySelector('button[aria-label="Refresh"]'));
	});
});
