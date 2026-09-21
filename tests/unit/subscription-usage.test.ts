// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionUsage } from "../../web/src/components/SubscriptionUsage";
import {
	formatCredit,
	formatResetCountdown,
	parseSubscriptionResponse,
	providerShortName,
	safePercent,
	usageLevel,
} from "../../web/src/subscription-usage.js";

const response = {
	status: "ready",
	refreshAfterMs: 180000,
	providers: [
		{
			providerId: "openai-codex",
			displayName: "Codex",
			state: "ok",
			windows: [{ label: "5 hours", windowSeconds: 18000, usedPercent: 120, resetsAt: null }],
			plan: "Pro",
			credits: [
				{ label: "Included", remaining: 12, unit: "credits" },
				{ label: "Balance", remaining: 1.5, unit: "USD" },
			],
			fetchedAt: null,
			checkedAt: "2025-01-01T00:00:00Z",
		},
	],
};

describe("subscription usage helpers", () => {
	it("clamps unsafe percentages and assigns warning thresholds", () => {
		expect(safePercent(-4)).toBe(0);
		expect(safePercent(Number.NaN)).toBe(0);
		expect(safePercent(140)).toBe(100);
		expect(usageLevel(79.99)).toBe("ok");
		expect(usageLevel(80)).toBe("warning");
		expect(usageLevel(100)).toBe("critical");
	});

	it("keeps a null reset time explicit", () => {
		expect(formatResetCountdown(null, 0)).toBe("Starts on first use");
		expect(formatResetCountdown("not-a-date", 0)).toBe("Reset time unavailable");
		expect(formatResetCountdown("1970-01-01T00:00:00Z", 0)).toBe("Resetting soon");
	});

	it("formats credits with their API units", () => {
		expect(formatCredit({ remaining: 12, unit: "credits" })).toBe("12 credits");
		expect(formatCredit({ remaining: 1.5, unit: "USD" })).toBe("$1.50");
	});

	it("parses provider rows while ignoring malformed nested rows", () => {
		const parsed = parseSubscriptionResponse({
			...response,
			providers: [...response.providers, null, { providerId: "bad" }],
		});
		expect(parsed?.providers).toHaveLength(1);
		expect(parsed?.providers[0].windows[0].usedPercent).toBe(100);
		expect(parsed?.providers[0].windows[0].resetsAt).toBeNull();
	});

	it("provides compact provider labels", () => {
		expect(providerShortName({ providerId: "codex", displayName: "OpenAI Codex" })).toBe("Codex");
		expect(providerShortName({ providerId: "go", displayName: "Google" })).toBe("Go");
		expect(providerShortName({ providerId: "opencode-go", displayName: "OpenCode Go" })).toBe("Go");
		expect(providerShortName({ providerId: "command", displayName: "Command R" })).toBe("Command");
	});
});

describe("subscription polling lifecycle", () => {
	let container: HTMLDivElement;
	let root: Root;
	let fetchMock: ReturnType<typeof vi.fn>;
	let clientSequence = 0;
	const changeVisibility = async (state: "hidden" | "visible") => {
		await act(async () => {
			Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
			document.dispatchEvent(new Event("visibilitychange"));
		});
	};
	const render = async () => {
		await act(async () => {
			root.render(SubscriptionUsageElement(`poll-test-${++clientSequence}`));
		});
	};
	beforeEach(() => {
		vi.useFakeTimers();
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});
	it("waits three minutes after settlement, pauses hidden, and stops on unmount", async () => {
		let resolveFirst!: (value: unknown) => void;
		fetchMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		await render();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(180_000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveFirst({ ok: true, json: async () => response });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(179_999);
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await changeVisibility("hidden");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(360_000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await changeVisibility("visible");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		await act(async () => {
			root.render(null);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(360_000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
	it("does not fetch while initially hidden and aborts in-flight work on close", async () => {
		await changeVisibility("hidden");
		fetchMock.mockImplementation(() => new Promise(() => {}));
		await render();
		expect(fetchMock).not.toHaveBeenCalled();
		await changeVisibility("visible");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
		await act(async () => {
			root.render(null);
		});
		expect(signal.aborted).toBe(true);
	});
	it("uses named icon buttons and an icon-only refresh control", async () => {
		await render();
		const button = container.querySelector<HTMLButtonElement>(".subscription-provider-button")!;
		expect(button.title).toBe("Codex");
		expect(button.getAttribute("aria-label")).toBe("Codex");
		expect(button.textContent).toBe("");
		expect(button.querySelector("img, svg")).not.toBeNull();
		await act(async () => {
			button.click();
		});
		const refresh = container.querySelector<HTMLButtonElement>(".subscription-refresh")!;
		expect(refresh.title).toBe("Refresh");
		expect(refresh.getAttribute("aria-label")).toBe("Refresh Codex usage");
		expect(refresh.textContent).toBe("");
	});

	it("manual provider refresh resets the poll deadline without overlap", async () => {
		await render();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100_000);
		});
		await act(async () => {
			container.querySelector<HTMLButtonElement>(".subscription-provider-button")!.click();
		});
		await act(async () => {
			container.querySelector<HTMLButtonElement>(".subscription-refresh")!.click();
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][1].method).toBe("POST");
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ providerId: "openai-codex" });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(80_000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100_000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

function SubscriptionUsageElement(clientId: string) {
	return createElement(SubscriptionUsage, { clientId, ready: true });
}
