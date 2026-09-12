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
	it("true when /agent or /piastra is registered", () => {
		expect(hasPiastraExtension([{ name: "agent" }])).toBe(true);
		expect(hasPiastraExtension([{ name: "piastra" }])).toBe(true);
		expect(hasPiastraExtension([{ name: "model" }, { name: "agent" }])).toBe(true);
	});

	it("false otherwise (neutral fallback — never guess from the model)", () => {
		expect(hasPiastraExtension(undefined)).toBe(false);
		expect(hasPiastraExtension(null)).toBe(false);
		expect(hasPiastraExtension([])).toBe(false);
		expect(hasPiastraExtension([{ name: "model" }, { name: "new" }])).toBe(false);
	});
});
