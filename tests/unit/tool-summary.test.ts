/**
 * tool-summary.ts: the one-line collapsed label. Tense follows phase, target
 * follows the tool kind, and dirty/partial args degrade to just the verb.
 */
import { describe, expect, it } from "vitest";
import { toolArgHints } from "../../web/src/tool-args.js";
import { commandPreview, toolSummary } from "../../web/src/tool-summary.js";

const sum = (name: string, args: string | undefined, phase: "running" | "done") =>
	toolSummary(name, toolArgHints(args), phase);

describe("toolSummary", () => {
	it("bash: verb + first command line, tense follows phase", () => {
		const r = sum("bash", '{"command":"git status --short"}', "running");
		expect(r).toMatchObject({ verb: "Running", target: "git status --short", mono: true });
		expect(sum("bash", '{"command":"git status"}', "done").verb).toBe("Ran");
	});

	it("bash: streaming half JSON still yields a command preview", () => {
		const r = sum("bash", '{"command":"npm run build && npm te', "running");
		expect(r.target).toBe("npm run build && npm te");
	});

	it("bash: multi-line command collapses to first line +N", () => {
		expect(commandPreview("a\nb\nc")).toBe("a +2");
		expect(commandPreview("   \n")).toBeUndefined();
		expect(commandPreview("x".repeat(100))).toBe(`${"x".repeat(72)}…`);
	});

	it("read/edit/write: verb + shortened path", () => {
		expect(sum("read", '{"path":"src/app.ts"}', "running")).toMatchObject({ verb: "Reading", target: "src/app.ts" });
		expect(sum("edit", '{"file_path":"src/app.ts","old":"a"}', "done").verb).toBe("Edited");
		expect(sum("write", '{"path":"out.txt","content":"..."}', "done").verb).toBe("Wrote");
	});

	it("grep: quoted pattern, optional location", () => {
		expect(sum("grep", '{"pattern":"TODO","path":"src"}', "running")).toMatchObject({
			verb: "Searching",
			target: '"TODO" in src',
		});
		expect(sum("grep", '{"pattern":"TODO"}', "done").target).toBe('"TODO"');
	});

	it("delegate: role counts, proportional face", () => {
		const args = '{"tasks":[{"role":"general","task":"a"},{"role":"general","task":"b"},{"role":"review","task":"c"}]}';
		expect(sum("delegate", args, "running")).toMatchObject({
			verb: "Delegating to",
			target: "2 general + review",
			mono: false,
			title: "3 workers: 2 general + review",
		});
		const half = sum("delegate", '{"tasks":[', "running");
		expect(half.verb).toBe("Delegating");
		expect(half.target).toBeUndefined();
		expect(sum("delegate", "{}", "done").verb).toBe("Delegated");
	});

	it("unknown tool: Calling <name>", () => {
		expect(sum("my_tool", '{"a":1}', "running")).toMatchObject({ verb: "Calling", target: "my_tool" });
		expect(sum("my_tool", undefined, "done").verb).toBe("Called");
	});

	it("dirty args: verb only, never throws", () => {
		const r = sum("read", "not json", "running");
		expect(r.verb).toBe("Reading");
		expect(r.target).toBeUndefined();
		expect(sum("bash", "{", "running").target).toBeUndefined();
	});
});
