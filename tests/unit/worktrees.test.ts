import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
	branchSlug,
	isManagedWorktree,
	parseWorktrees,
	resolveWorktreePath,
	sameWorktreePath,
} from "../../server/worktrees.js";

const porcelain = [
	"worktree /home/me/repo",
	"HEAD 1111111111111111111111111111111111111111",
	"branch refs/heads/main",
	"",
	"worktree /home/me/.pi/worktrees/repo/feat-x",
	"HEAD 2222222222222222222222222222222222222222",
	"branch refs/heads/feat/x",
	"locked",
	"",
	"worktree /tmp/det",
	"HEAD 3333333333333333333333333333333333333333",
	"detached",
	"",
	"worktree /gone",
	"HEAD 4444444444444444444444444444444444444444",
	"branch refs/heads/old",
	"prunable gitdir file points to non-existent location",
	"",
].join("\n");

describe("parseWorktrees", () => {
	it("main checkout first, branches stripped, detached/locked/prunable flags", () => {
		const list = parseWorktrees(porcelain);
		expect(list.map((w) => [w.branch, w.locked, w.prunable])).toEqual([
			["main", false, false],
			["feat/x", true, false],
			[null, false, false],
			["old", false, true],
		]);
		expect(list[0].path).toBe(resolve("/home/me/repo"));
		expect(list[1].head).toBe("2222222222222222222222222222222222222222");
	});

	it("tolerates a missing trailing blank line and empty input", () => {
		expect(parseWorktrees("worktree /r\nHEAD abc\nbranch refs/heads/m")).toHaveLength(1);
		expect(parseWorktrees("")).toEqual([]);
	});
});

describe("branchSlug / resolveWorktreePath (same rules as the CLI extension)", () => {
	it("slugs separators and case, strips refs/heads", () => {
		expect(branchSlug("feat/Login Page")).toBe("feat-login-page");
		expect(branchSlug("refs/heads/fix/x")).toBe("fix-x");
	});
	it("falls back to a hashed name for reserved or empty slugs", () => {
		expect(branchSlug("CON")).toMatch(/^branch-[0-9a-f]{6}$/);
		expect(branchSlug("///")).toMatch(/^branch-[0-9a-f]{6}$/);
	});
	it("lays out ~/.pi/worktrees/<repo>/<slug>", () => {
		expect(resolveWorktreePath("/src/PiAstra", "feat/x", "/home/me")).toBe(
			join("/home/me", ".pi", "worktrees", "PiAstra", "feat-x"),
		);
	});
});

describe("isManagedWorktree", () => {
	it("recognises paths under the managed root only", () => {
		expect(isManagedWorktree(resolve("/home/me/.pi/worktrees/PiAstra/feat-x"), "/home/me")).toBe(true);
		expect(isManagedWorktree(resolve("/home/me/.pi/worktrees"), "/home/me")).toBe(false);
		expect(isManagedWorktree(resolve("/home/me/src/PiAstra"), "/home/me")).toBe(false);
		expect(isManagedWorktree(resolve("/home/me/.pi/worktreesX/a"), "/home/me")).toBe(false);
	});
});

describe("sameWorktreePath", () => {
	it("ignores separator style", () => {
		expect(sameWorktreePath("/a/b", "/a/b/")).toBe(true);
		expect(sameWorktreePath("/a/b", "/a/c")).toBe(false);
	});
});
