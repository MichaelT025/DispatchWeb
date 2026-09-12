import { describe, expect, it } from "vitest";
import { resolveWindowsBashShell, resolveWindowsUserShell } from "../../server/terminals.js";

/**
 * Windows shell-selection unit tests. Both resolvers are pure given an injected
 * `env` and `exists` probe, so they run identically on any host OS.
 *
 * The contract these lock in:
 *  - the USER interactive terminal defaults to PowerShell (pwsh → powershell.exe)
 *    so a browser tab opens the shell Windows users expect;
 *  - the AI bash terminal ('ai-bash') ALWAYS resolves bash, so agent commands
 *    keep bash semantics (heredocs, &&, process substitution) regardless of the
 *    user-terminal default.
 */

/** Build an `exists` probe that reports true only for an exact set of paths. */
function only(...present: string[]): (p: string) => boolean {
	const set = new Set(present);
	return (p) => set.has(p);
}

const PWSh64 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const PWSh86 = "C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe";
const PS51 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const GIT_BASH86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";

describe("resolveWindowsUserShell", () => {
	it("PI_WEB_SHELL 显式覆盖一切", () => {
		const env = {
			PI_WEB_SHELL: "C:\\tools\\nu.exe",
			ProgramFiles: "C:\\Program Files",
		};
		// Even though pwsh exists, the explicit override wins.
		const r = resolveWindowsUserShell(env, only(PWSh64, "C:\\tools\\nu.exe"));
		expect(r).toEqual({ shell: "C:\\tools\\nu.exe", args: [] });
	});

	it("PI_WEB_SHELL 指向 bash 时带 -i", () => {
		const r = resolveWindowsUserShell({ PI_WEB_SHELL: GIT_BASH }, only(GIT_BASH));
		expect(r).toEqual({ shell: GIT_BASH, args: ["-i"] });
	});

	it("优先 64 位 pwsh，其次 32 位", () => {
		const env = {
			ProgramFiles: "C:\\Program Files",
			"ProgramFiles(x86)": "C:\\Program Files (x86)",
		};
		expect(resolveWindowsUserShell(env, only(PWSh64, PWSh86))).toEqual({ shell: PWSh64, args: [] });
		expect(resolveWindowsUserShell(env, only(PWSh86))).toEqual({
			shell: PWSh86,
			args: [],
		});
	});

	it("无安装目录时从 PATH 找 pwsh（scoop/choco/portable）", () => {
		const env = { PATH: "C:\\scoop\\shims;C:\\Windows\\System32" };
		const scoop = "C:\\scoop\\shims\\pwsh.exe";
		expect(resolveWindowsUserShell(env, only(scoop))).toEqual({
			shell: scoop,
			args: [],
		});
	});

	it("没有 pwsh 时回退 powershell.exe (5.1)", () => {
		const env = { SystemRoot: "C:\\Windows" };
		expect(resolveWindowsUserShell(env, only(PS51))).toEqual({
			shell: PS51,
			args: [],
		});
	});

	it("pwsh 存在时绝不退到 powershell.exe", () => {
		const env = {
			ProgramFiles: "C:\\Program Files",
			SystemRoot: "C:\\Windows",
		};
		expect(resolveWindowsUserShell(env, only(PWSh64, PS51))).toEqual({
			shell: PWSh64,
			args: [],
		});
	});

	it("无 PowerShell 时才回退 bash（$SHELL → Git Bash → busybox）", () => {
		const env = {
			SHELL: "C:\\msys64\\usr\\bin\\bash.exe",
			ProgramFiles: "C:\\Program Files",
		};
		const msys = "C:\\msys64\\usr\\bin\\bash.exe";
		expect(resolveWindowsUserShell(env, only(msys))).toEqual({
			shell: msys,
			args: ["-i"],
		});
		expect(resolveWindowsUserShell({ ProgramFiles: "C:\\Program Files" }, only(GIT_BASH))).toEqual({
			shell: GIT_BASH,
			args: ["-i"],
		});
	});

	it("最后兜底 $COMSPEC（cmd.exe）", () => {
		const env = { COMSPEC: "C:\\Windows\\System32\\cmd.exe" };
		expect(resolveWindowsUserShell(env, only())).toEqual({
			shell: "C:\\Windows\\System32\\cmd.exe",
			args: [],
		});
	});

	it("空环境也不抛异常", () => {
		const r = resolveWindowsUserShell({}, only());
		expect(r.shell).toBe("powershell.exe");
		expect(r.args).toEqual([]);
	});
});

describe("resolveWindowsBashShell (AI bash tool)", () => {
	it("用户终端默认 PowerShell 时，AI 终端仍解析为 Git Bash", () => {
		const env = {
			ProgramFiles: "C:\\Program Files",
			"ProgramFiles(x86)": "C:\\Program Files (x86)",
		};
		// Sanity: the user shell would be pwsh for this same env…
		// …but the AI bash resolver ignores PowerShell entirely.
		const r = resolveWindowsBashShell(env, only(GIT_BASH, PWSh64));
		expect(r).toEqual({ shell: GIT_BASH, args: ["-i"] });
	});

	it("优先 64 位 Git Bash，其次 32 位", () => {
		const env = {
			ProgramFiles: "C:\\Program Files",
			"ProgramFiles(x86)": "C:\\Program Files (x86)",
		};
		expect(resolveWindowsBashShell(env, only(GIT_BASH, GIT_BASH86))).toEqual({
			shell: GIT_BASH,
			args: ["-i"],
		});
		expect(resolveWindowsBashShell(env, only(GIT_BASH86))).toEqual({
			shell: GIT_BASH86,
			args: ["-i"],
		});
	});

	it("$SHELL 仅在其为 bash 时才采用；zsh/其它一律回退裸 bash", () => {
		// NOTE: the existing check is a literal `endsWith("bash")`, so Git Bash's
		// `$SHELL` value `/usr/bin/bash` matches while a `bash.exe` path does NOT
		// (it falls through to bare `bash`). This mirrors the pre-refactor
		// resolveBashShell behaviour and is locked in here intentionally.
		const bash = "/usr/bin/bash";
		expect(resolveWindowsBashShell({ SHELL: bash }, only(bash))).toEqual({
			shell: bash,
			args: ["-i"],
		});
		// zsh (or a `bash.exe` path) as $SHELL must NOT be used for the bash tool.
		expect(resolveWindowsBashShell({ SHELL: "C:\\custom\\zsh.exe" }, only("C:\\custom\\zsh.exe")).shell).toBe("bash");
		expect(resolveWindowsBashShell({ SHELL: "C:\\custom\\bash.exe" }, only("C:\\custom\\bash.exe")).shell).toBe("bash");
	});

	it("全部缺失时回退裸 `bash`（靠 PATH）并仍是交互式", () => {
		expect(resolveWindowsBashShell({}, only())).toEqual({
			shell: "bash",
			args: ["-i"],
		});
	});
});
