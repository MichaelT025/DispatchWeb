import { describe, expect, it } from "vitest";
import {
	AGENT_ROLES,
	hasDispatchExtension,
	hasPiastraExtension,
	isAgentRole,
	parseAgentRole,
} from "../../web/src/agents.js";

describe("parseAgentRole", () => {
	it("parses the extension status text into the confirmed role", () => {
		expect(parseAgentRole([{ key: "piastra-agent", text: "Agent: review" }])).toBe("review");
		expect(
			parseAgentRole([
				{ key: "other", text: "x" },
				{ key: "piastra-agent", text: "Agent: orchestrator" },
			]),
		).toBe("orchestrator");
	});

	it("is case- and whitespace-tolerant", () => {
		expect(parseAgentRole([{ key: "piastra-agent", text: "Agent: Fast" }])).toBe("fast");
		expect(parseAgentRole([{ key: "piastra-agent", text: "  Agent:   general  " }])).toBe("general");
	});

	it("returns null for missing / malformed / unknown status", () => {
		expect(parseAgentRole(undefined)).toBeNull();
		expect(parseAgentRole(null)).toBeNull();
		expect(parseAgentRole([])).toBeNull();
		expect(parseAgentRole([{ key: "x", text: "Agent: review" }])).toBeNull();
		expect(parseAgentRole([{ key: "piastra-agent", text: undefined }])).toBeNull();
		// No "Agent:" prefix — never guess.
		expect(parseAgentRole([{ key: "piastra-agent", text: "review" }])).toBeNull();
		// Unknown role — never guess.
		expect(parseAgentRole([{ key: "piastra-agent", text: "Agent: boss" }])).toBeNull();
	});

	it("keeps the legacy piastra-agent status key", () => {
		// Intentional legacy token: the Dispatch extension still bridges
		// `setStatus("piastra-agent", ...)` for installed-version compat.
		expect(parseAgentRole([{ key: "dispatch-agent", text: "Agent: review" }])).toBeNull();
	});
});

describe("isAgentRole", () => {
	it("accepts exactly the four roles", () => {
		for (const role of AGENT_ROLES) expect(isAgentRole(role)).toBe(true);
		expect(isAgentRole("boss")).toBe(false);
		expect(isAgentRole(42)).toBe(false);
		expect(isAgentRole(null)).toBe(false);
	});
});

describe("hasDispatchExtension", () => {
	it("true for the canonical /agent + /dispatch extension commands", () => {
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "extension" },
				{ name: "dispatch", source: "extension" },
			]),
		).toBe(true);
		// Extra catalog entries (builtins, skills, templates) do not interfere.
		expect(
			hasDispatchExtension([
				{ name: "model", source: "builtin" },
				{ name: "agent", source: "extension" },
				{ name: "dispatch", source: "extension" },
				{ name: "review", source: "skill" },
			]),
		).toBe(true);
	});

	it("true for legacy /piastra summary alias (mixed-version compat)", () => {
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "extension" },
				{ name: "piastra", source: "extension" },
			]),
		).toBe(true);
	});

	it("keeps hasPiastraExtension as a compatibility alias", () => {
		expect(hasPiastraExtension).toBe(hasDispatchExtension);
		expect(
			hasPiastraExtension([
				{ name: "agent", source: "extension" },
				{ name: "dispatch", source: "extension" },
			]),
		).toBe(true);
	});

	it("false when only one of the two extension commands is present", () => {
		expect(hasDispatchExtension([{ name: "agent", source: "extension" }])).toBe(false);
		expect(hasDispatchExtension([{ name: "dispatch", source: "extension" }])).toBe(false);
		expect(hasDispatchExtension([{ name: "piastra", source: "extension" }])).toBe(false);
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "extension" },
				{ name: "dispatch", source: "builtin" },
			]),
		).toBe(false);
	});

	it("false when a prompt template reuses an extension command name", () => {
		// A template named "agent"/"dispatch" must NOT enable role mode: sending
		// `/agent <role>` would be expanded as a template / plain prompt.
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "prompt" },
				{ name: "dispatch", source: "extension" },
			]),
		).toBe(false);
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "extension" },
				{ name: "dispatch", source: "prompt" },
			]),
		).toBe(false);
	});

	it("false when a UI plugin or skill reuses an extension command name", () => {
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "plugin" },
				{ name: "dispatch", source: "plugin" },
			]),
		).toBe(false);
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "skill" },
				{ name: "dispatch", source: "extension" },
			]),
		).toBe(false);
		// Legacy alias gets the same guard.
		expect(
			hasDispatchExtension([
				{ name: "agent", source: "extension" },
				{ name: "piastra", source: "prompt" },
			]),
		).toBe(false);
	});

	it("false without a source (untrusted / legacy catalog entry)", () => {
		// A bare name is not enough — only source === "extension" proves ownership.
		expect(hasDispatchExtension([{ name: "agent" }, { name: "dispatch" }])).toBe(false);
		expect(hasDispatchExtension([{ name: "agent" }, { name: "piastra" }])).toBe(false);
	});

	it("false otherwise (neutral fallback — never guess from the model)", () => {
		expect(hasDispatchExtension(undefined)).toBe(false);
		expect(hasDispatchExtension(null)).toBe(false);
		expect(hasDispatchExtension([])).toBe(false);
		expect(
			hasDispatchExtension([
				{ name: "model", source: "builtin" },
				{ name: "new", source: "builtin" },
			]),
		).toBe(false);
	});
});
