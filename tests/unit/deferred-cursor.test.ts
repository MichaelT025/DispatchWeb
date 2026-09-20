// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scheduleDeferredCursor } from "../../web/src/deferred-cursor.js";

describe("scheduleDeferredCursor", () => {
	const originalRequestAnimationFrame = window.requestAnimationFrame;
	const originalCancelAnimationFrame = window.cancelAnimationFrame;
	let callbacks: Map<number, FrameRequestCallback>;
	let nextFrame = 1;

	beforeEach(() => {
		callbacks = new Map();
		nextFrame = 1;
		window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			const id = nextFrame++;
			callbacks.set(id, callback);
			return id;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = ((id: number) => {
			callbacks.delete(id);
		}) as typeof window.cancelAnimationFrame;
	});

	afterEach(() => {
		window.requestAnimationFrame = originalRequestAnimationFrame;
		window.cancelAnimationFrame = originalCancelAnimationFrame;
	});

	it("does not move the caret when the draft changes before the delayed callback", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "/cwd";
		textarea.selectionStart = textarea.selectionEnd = 1;

		scheduleDeferredCursor(textarea, "/cwd");
		textarea.value = "first line\nsecond line";
		textarea.selectionStart = textarea.selectionEnd = 3;
		callbacks.get(1)?.(0);

		expect(textarea.selectionStart).toBe(3);
		expect(textarea.selectionEnd).toBe(3);
	});

	it("places the caret at the end when the expected history value remains", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "/cwd";
		textarea.selectionStart = textarea.selectionEnd = 0;

		scheduleDeferredCursor(textarea, "/cwd");
		callbacks.get(1)?.(0);

		expect(textarea.selectionStart).toBe(4);
		expect(textarea.selectionEnd).toBe(4);
	});

	it("can cancel a pending placement", () => {
		const textarea = document.createElement("textarea");
		textarea.value = "/cwd";
		textarea.selectionStart = textarea.selectionEnd = 1;

		const cancel = scheduleDeferredCursor(textarea, "/cwd");
		cancel();
		callbacks.get(1)?.(0);

		expect(textarea.selectionStart).toBe(1);
		expect(textarea.selectionEnd).toBe(1);
	});
});
