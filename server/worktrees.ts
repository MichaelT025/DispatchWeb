/**
 * Git worktree discovery for the project sidebar.
 *
 * A worktree is a second checkout of one repository, so it must nest under
 * the repository's main checkout in the sidebar instead of showing up as an
 * unrelated project. Everything here is read-only plumbing around
 * `git worktree list --porcelain`; the parser, slug and managed-path rules
 * mirror PiAstra's CLI extension (`extensions/pi-worktree/git-worktree.ts`)
 * so worktrees created from either side look the same to both.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;

export interface GitWorktree {
	/** Absolute checkout path, normalized with `path.resolve`. */
	path: string;
	head: string;
	/** Branch name without `refs/heads/`; null when detached. */
	branch: string | null;
	bare: boolean;
	locked: boolean;
	/** Git can no longer find the checkout directory. */
	prunable: boolean;
}

/** Parse `git worktree list --porcelain`. The first entry is the main checkout. */
export function parseWorktrees(porcelain: string): GitWorktree[] {
	const items: GitWorktree[] = [];
	let current: Partial<GitWorktree> | null = null;

	const push = () => {
		if (current?.path) {
			items.push({
				path: resolve(current.path),
				head: current.head ?? "",
				branch: current.branch ?? null,
				bare: current.bare ?? false,
				locked: current.locked ?? false,
				prunable: current.prunable ?? false,
			});
		}
		current = null;
	};

	for (const line of porcelain.split("\n")) {
		if (line.length === 0) {
			push();
			continue;
		}
		if (line.startsWith("worktree ")) {
			push();
			current = { path: line.slice("worktree ".length) };
			continue;
		}
		if (!current) continue;
		if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
		else if (line.startsWith("branch ")) {
			const ref = line.slice("branch ".length);
			current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
		} else if (line === "detached") current.branch = null;
		else if (line === "bare") current.bare = true;
		else if (line.startsWith("locked")) current.locked = true;
		else if (line.startsWith("prunable")) current.prunable = true;
	}
	push();
	return items;
}

/** Every checkout of the repository containing `dir`; [] outside a repo or on
 *  any git failure (missing git, timeout, dubious ownership …). */
export async function listWorktrees(dir: string): Promise<GitWorktree[]> {
	try {
		const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], {
			cwd: dir,
			timeout: GIT_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 1024 * 1024,
		});
		return parseWorktrees(stdout);
	} catch {
		return [];
	}
}

function slugHash(value: string): string {
	let hash = 2166136261;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

function isWindowsReservedName(slug: string): boolean {
	const stem = slug.split(".", 1)[0].toLowerCase();
	return ["con", "prn", "aux", "nul"].includes(stem) || /^(com|lpt)[1-9]$/.test(stem);
}

/** Directory name for a branch: `feat/login` → `feat-login`. Same rule as the CLI. */
export function branchSlug(branch: string): string {
	const name = branch.replace(/^refs\/heads\//, "");
	const slug = name
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
	if (slug && !isWindowsReservedName(slug)) return slug;
	return `branch-${slugHash(name)}`;
}

/** Root of the managed worktree layout shared with the CLI. */
export function managedWorktreesRoot(home = homedir()): string {
	return join(home, ".pi", "worktrees");
}

/** Managed worktree path for a branch: `~/.pi/worktrees/<repo>/<slug>`. */
export function resolveWorktreePath(mainPath: string, branch: string, home = homedir()): string {
	return join(managedWorktreesRoot(home), basename(mainPath), branchSlug(branch));
}

function pathKey(p: string): string {
	const r = resolve(p);
	return process.platform === "win32" ? r.toLowerCase() : r;
}

/** True when `path` lives under the managed `~/.pi/worktrees` layout. */
export function isManagedWorktree(path: string, home = homedir()): boolean {
	const root = pathKey(managedWorktreesRoot(home));
	const key = pathKey(path);
	return key.startsWith(root + "\\") || key.startsWith(root + "/");
}

/** Same checkout regardless of separator/case differences. */
export function sameWorktreePath(a: string, b: string): boolean {
	return pathKey(a) === pathKey(b);
}
