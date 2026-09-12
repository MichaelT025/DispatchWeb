import { describe, expect, it } from "vitest";
import { AGENT_ROLES, hasPiastraExtension, isAgentRole, parseAgentRole } from "../../web/src/agents.js";

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
});

describe("isAgentRole", () => {
	it("accepts exactly the four roles", () => {
		for (const role of AGENT_ROLES) expect(isAgentRole(role)).toBe(true);
		expect(isAgentRole("boss")).toBe(false);
		expect(isAgentRole(42)).toBe(false);
		expect(isAgentRole(null)).toBe(false);
	});
});

describe("hasPiastraExtension", () => {
	it("true only when BOTH /agent and /piastra are extension commands", () => {
		expect(
			hasPiastraExtension([
				{ name: "agent", source: "extension" },
				{ name: "piastra", source: "extension" },
			]),
		).toBe(true);
		// Extra catalog entries (builtins, skills, templates) do not interfere.
		expect(
			hasPiastraExtension([
				{ name: "model", source: "builtin" },
				{ name: "agent", source: "extension" },
				{ name: "piastra", source: "extension" },
				{ name: "review", source: "skill" },
			]),
		).toBe(true);
	});

	it("false when only one of the two extension commands is present", () => {
		expect(hasPiastraExtension([{ name: "agent", source: "extension" }])).toBe(false);
		expect(hasPiastraExtension([{ name: "piastra", source: "extension" }])).toBe(false);
		expect(
			hasPiastraExtension([
				{ name: "agent", source: "extension" },
				{ name: "piastra", source: "builtin" },
			]),
		).toBe(false);
	});

	it("false when a prompt template reuses an extension command name", () => {
		// A template named "agent"/"piastra" must NOT enable role mode: sending
		// `/agent <role>` would be expanded as a template / plain prompt.
		expect(
			hasPiastraExtension([
				{ name: "agent", source: "prompt" },
				{ name: "piastra", source: "extension" },
			]),
		).toBe(false);
		expect(
			hasPiastraExtension([
				{ name: "agent", source: "extension" },
				{ name: "piastra", source: "prompt" },
			]),
		).toBe(false);
	});

	it("false when a UI plugin reuses an extension command name", () => {
		expect(
			hasPiastraExtension([
				{ name: "agent", source: "plugin" },
				{ name: "piastra", source: "plugin" },
			]),
		).toBe(false);
	});

	it("false without a source (untrusted / legacy catalog entry)", () => {
		// A bare name is not enough — only source === "extension" proves ownership.
		expect(hasPiastraExtension([{ name: "agent" }, { name: "piastra" }])).toBe(false);
	});

	it("false otherwise (neutral fallback — never guess from the model)", () => {
		expect(hasPiastraExtension(undefined)).toBe(false);
		expect(hasPiastraExtension(null)).toBe(false);
		expect(hasPiastraExtension([])).toBe(false);
		expect(
			hasPiastraExtension([
				{ name: "model", source: "builtin" },
				{ name: "new", source: "builtin" },
			]),
		).toBe(false);
	});
});
