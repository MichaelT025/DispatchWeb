import { describe, expect, it } from "vitest";
import { SHIMMER_PERIOD_MS, shimmerPhase } from "../../web/src/shimmer.js";

describe("shimmerPhase", () => {
	it("is a stable negative delay inside one period", () => {
		const a = shimmerPhase("call_1");
		expect(a).toEqual(shimmerPhase("call_1"));
		const ms = Number(String(a.animationDelay).replace(/^-|ms$/g, ""));
		expect(ms).toBeGreaterThanOrEqual(0);
		expect(ms).toBeLessThan(SHIMMER_PERIOD_MS);
		expect(String(a.animationDelay).startsWith("-")).toBe(true);
	});

	it("spreads neighbouring ids across the cycle", () => {
		const phases = new Set([1, 2, 3, 4, 5].map((id) => shimmerPhase(id).animationDelay));
		expect(phases.size).toBe(5);
	});
});
