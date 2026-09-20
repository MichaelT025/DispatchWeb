// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LanguageProvider } from "../../web/src/i18n.js";
import { PromptMinimap, type PromptMinimapQuestion } from "../../web/src/components/PromptMinimap.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const questions = (count: number): PromptMinimapQuestion[] =>
	Array.from({ length: count }, (_, index) => ({ id: `q-${index}`, text: `Prompt ${index}` }));

function mount(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => root!.render(createElement(LanguageProvider, null, element)));
	return container;
}

function update(element: ReactElement) {
	act(() => root!.render(createElement(LanguageProvider, null, element)));
}

afterEach(() => {
	vi.useRealTimers();
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
});

describe("PromptMinimap", () => {
	it("mounts its observer when an empty rail becomes populated", () => {
		const container = mount(createElement(PromptMinimap, { questions: [], activeIndex: -1, onJump: vi.fn() }));
		expect(container.querySelectorAll(".qn-bar")).toHaveLength(0);
		update(createElement(PromptMinimap, { questions: questions(2), activeIndex: 0, onJump: vi.fn() }));
		expect(container.querySelectorAll(".qn-bar")).toHaveLength(2);
	});

	it("re-reveals the active tick after a same-count question mutation", () => {
		const qs = questions(20);
		const container = mount(createElement(PromptMinimap, { questions: qs, activeIndex: 10, onJump: vi.fn() }));
		const viewport = container.querySelector<HTMLElement>(".qn-rail-viewport")!;
		Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 14 });
		viewport.scrollTop = 90;
		const mutated = qs.map((question, index) => ({ ...question, text: index === 3 ? "changed" : question.text }));
		update(createElement(PromptMinimap, { questions: mutated, activeIndex: 10, onJump: vi.fn() }));
		expect(viewport.scrollTop).toBeGreaterThan(0);
		expect(container.querySelector('[data-qn-index="10"]')).not.toBeNull();
	});

	it("re-runs active reveal when the observed viewport resizes", () => {
		const original = globalThis.ResizeObserver;
		let notify: (() => void) | null = null;
		class MockResizeObserver {
			constructor(callback: () => void) {
				notify = callback;
			}
			observe() {}
			disconnect() {}
		}
		Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: MockResizeObserver });
		try {
			const container = mount(
				createElement(PromptMinimap, { questions: questions(20), activeIndex: 10, onJump: vi.fn() }),
			);
			const viewport = container.querySelector<HTMLElement>(".qn-rail-viewport")!;
			viewport.scrollTop = 0;
			Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 14 });
			act(() => notify?.());
			expect(viewport.scrollTop).toBeGreaterThan(0);
		} finally {
			Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: original });
		}
	});

	it("restores the focused preview when pointer hover exits", () => {
		vi.useFakeTimers();
		const container = mount(createElement(PromptMinimap, { questions: questions(3), activeIndex: 0, onJump: vi.fn() }));
		const focused = container.querySelector<HTMLButtonElement>('[data-qn-index="0"]')!;
		const hovered = container.querySelector<HTMLButtonElement>('[data-qn-index="1"]')!;
		act(() => focused.focus());
		act(() => vi.advanceTimersByTime(200));
		expect(container.querySelector('[role="tooltip"]')?.textContent).toContain("Prompt 0");
		act(() => hovered.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
		act(() => vi.advanceTimersByTime(200));
		expect(container.querySelector('[role="tooltip"]')?.textContent).toContain("Prompt 1");
		act(() => hovered.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
		act(() => vi.advanceTimersByTime(200));
		expect(container.querySelector('[role="tooltip"]')?.textContent).toContain("Prompt 0");
	});

	it("shows one delayed preview for hover and focus, and clears it immediately on leave", () => {
		vi.useFakeTimers();
		const container = mount(createElement(PromptMinimap, { questions: questions(3), activeIndex: 0, onJump: vi.fn() }));
		const tick = container.querySelector<HTMLButtonElement>('[data-qn-index="1"]')!;

		act(() => tick.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
		act(() => vi.advanceTimersByTime(199));
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
		act(() => vi.advanceTimersByTime(1));
		expect(container.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
		expect(container.querySelector('[role="tooltip"]')?.textContent).toContain("Prompt 1");

		act(() => tick.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
		act(() => tick.focus());
		act(() => vi.advanceTimersByTime(200));
		expect(container.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
	});

	it("keeps idle ticks compact, expands local ticks, and jumps directly", () => {
		const onJump = vi.fn();
		const qs = questions(10);
		const container = mount(createElement(PromptMinimap, { questions: qs, activeIndex: 4, onJump }));
		const active = container.querySelector<HTMLButtonElement>('[data-qn-index="4"]')!;
		const neighbor = container.querySelector<HTMLButtonElement>('[data-qn-index="3"]')!;
		const idle = container.querySelector<HTMLButtonElement>('[data-qn-index="0"]')!;
		expect(active.style.width).toBe("24px");
		expect(active.style.getPropertyValue("--tick-width")).toBe("24px");
		expect(neighbor.style.getPropertyValue("--tick-width")).toBe("22px");
		expect(idle.style.getPropertyValue("--tick-width")).toBe("16px");
		expect(active.getAttribute("aria-current")).toBe("location");
		act(() => active.click());
		expect(onJump).toHaveBeenCalledWith("q-4");
	});

	it("reveals active changes after hover releases the rail", () => {
		const qs = questions(500);
		const container = mount(createElement(PromptMinimap, { questions: qs, activeIndex: 50, onJump: vi.fn() }));
		const hovered = container.querySelector<HTMLButtonElement>('[data-qn-index="50"]')!;
		act(() => hovered.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
		update(createElement(PromptMinimap, { questions: qs, activeIndex: 400, onJump: vi.fn() }));
		expect(container.querySelector('[data-qn-index="400"]')).toBeNull();
		act(() => hovered.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
		expect(container.querySelector('[data-qn-index="400"]')).not.toBeNull();
	});

	it("keeps keyboard navigation bounded and focuses the virtualized destination", () => {
		const qs = questions(10);
		const container = mount(createElement(PromptMinimap, { questions: qs, activeIndex: 0, onJump: vi.fn() }));
		const first = container.querySelector<HTMLButtonElement>('[data-qn-index="0"]')!;
		act(() => first.focus());
		act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
		expect(document.activeElement).toBe(first);
		act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
		expect(container.querySelector<HTMLButtonElement>('[data-qn-index="9"]')).toBe(document.activeElement);
		const last = document.activeElement as HTMLButtonElement;
		act(() => last.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
		expect(document.activeElement).toBe(last);
	});

	it("bounds DOM for 5000 prompts and resets session interaction state", () => {
		vi.useFakeTimers();
		const onJump = vi.fn();
		const container = mount(createElement(PromptMinimap, { questions: questions(5000), activeIndex: 2500, onJump }));
		expect(container.querySelectorAll(".qn-bar").length).toBeLessThan(100);
		expect(container.querySelector('[data-qn-index="2500"]')).not.toBeNull();

		const tick = container.querySelector<HTMLButtonElement>('[data-qn-index="2500"]')!;
		act(() => tick.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
		act(() => vi.advanceTimersByTime(200));
		expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
		update(createElement(PromptMinimap, { questions: questions(2), activeIndex: 0, onJump }));
		expect(container.querySelectorAll(".qn-bar")).toHaveLength(2);
		expect(container.querySelector('[role="tooltip"]')).toBeNull();
	});
});
