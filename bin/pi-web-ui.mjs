#!/usr/bin/env node
/**
 * pi-web-ui CLI.
 *
 *   pi-web-ui                              启动生产服务器（前台，Ctrl+C 停止，自动打开浏览器）
 *   pi-web-ui --port 9000 --cwd /path      同上，覆盖端口/工作目录/数据目录
 *   pi-web-ui --no-browser                 启动但不自动打开浏览器
 *   pi-web-ui --version | --help
 *   pi-web-ui server install [选项]         安装系统服务（开机自启）并启动
 *   pi-web-ui server shortcut [选项]        在桌面创建「一键启动」图标（启动服务并打开浏览器）
 *   pi-web-ui server uninstall [选项]       卸载系统服务（同时移除桌面图标）
 *   pi-web-ui server start|stop|restart|status [选项]
 *
 * 系统服务：
 *   - macOS   → launchd 用户代理，label 默认 com.xingshuyin.pi-web-ui
 *              （--name 自定义时 com.<name>.server），无需 sudo
 *   - Linux   → systemd 单元 <name>.service（/etc/systemd/system/，自动 sudo）
 *   - Windows → 登录自启 Run 键（HKCU，无需管理员）+ wscript 隐藏启动（无黑窗）；
 *              PowerShell 启动脚本 / VBS 启动器 / PID 文件生成在
 *              %APPDATA%\pi-web-ui\
 *
 * 环境变量（flag 优先，环境变量后备）：PI_WEB_PORT / PI_WEB_CWD / PI_WEB_DATA_DIR /
 * PI_WEB_HOST / PI_CODING_AGENT_DIR；token 仅环境变量，不走命令行。
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { get as httpGet } from "node:http";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	realpathSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
/** <pkg>/dist/server/index.js — the actual server entry. */
const SERVER_ENTRY = join(BIN_DIR, "..", "dist", "server", "index.js");
const NODE = process.execPath;
let pkg = { version: "0.0.0" };
try {
	pkg = JSON.parse(readFileSync(join(BIN_DIR, "..", "package.json"), "utf8"));
} catch {
	// version is best-effort — the server itself doesn't need it
}

const HELP = `pi-web-ui v${pkg.version} — Dispatch Web UI for the pi coding agent

Usage:
  pi-web-ui                               Start server (foreground, Ctrl+C to stop, auto-opens browser)
  pi-web-ui --port 9000 --cwd /path        Start with port/cwd/data-dir overrides
  pi-web-ui --no-browser                   Start without auto-opening browser
  pi-web-ui server install [options]       Install system service (autostart on boot) and launch it
  pi-web-ui server shortcut [options]      Create desktop "one-click start" icon
  pi-web-ui server uninstall [options]     Uninstall system service (also removes desktop icon)
  pi-web-ui server start|stop|restart|status [options]
  pi-web-ui server quiesce [options]       Drain mode: reject new chats/messages/edits; let current runs finish
  pi-web-ui server unquiesce [options]     Exit drain mode, resume accepting new work
  pi-web-ui --version / --help

Server options:
  --port <n>        Port (default 8787, or $PI_WEB_PORT)
  --cwd <dir>       Working directory (default $PI_WEB_CWD or home dir; foreground uses current dir)
  --data-dir <dir>  Session data directory (default <cwd>/.pi-web)
  --host <addr>     Listen address (default $PI_WEB_HOST or 127.0.0.1; 0.0.0.0 for LAN/containers)
  --agent-dir <dir> pi config directory (default $PI_CODING_AGENT_DIR or ~/.pi/agent)
  --name <name>     Service name (default pi-web-ui; macOS launchd label is
                    com.xingshuyin.pi-web-ui, or com.<name>.server for custom names)
  --print           Only print generated config files (no actual install)

Platforms: macOS → launchd user agent · Linux → systemd · Windows → Logon Run key
           (HKCU, no admin needed; wscript hidden launch, no black window)
Shortcuts: Windows → desktop .lnk · macOS → desktop .command · Linux → desktop .desktop

Environment variables (flag takes precedence, env var as fallback):
  PI_WEB_PORT / PI_WEB_CWD / PI_WEB_DATA_DIR / PI_WEB_HOST / PI_CODING_AGENT_DIR
  Auth token PI_WEB_TOKEN: env var only (not on command line, to avoid ps exposure)
`;

/** Minimum Node required by the pi SDK (its dist uses `import … with { type: "json" }`). */
const NODE_MIN = [22, 19, 0];
function checkNodeVersion() {
	const v = process.versions.node.split(".").map(Number);
	const tooOld =
		v[0] < NODE_MIN[0] ||
		(v[0] === NODE_MIN[0] && v[1] < NODE_MIN[1]) ||
		(v[0] === NODE_MIN[0] && v[1] === NODE_MIN[1] && v[2] < NODE_MIN[2]);
	if (tooOld) {
		const zh =
			`✖ pi-web-ui 需要 Node.js >= ${NODE_MIN.join(".")}（当前 ${process.versions.node}）。\n` +
			`  pi SDK 的代码使用了 import attributes（with）语法，旧版 Node 无法解析。\n` +
			`  请升级 Node：https://nodejs.org（或 nvm-windows / fnm）后重装：npm i -g pi-web-ui`;
		const en =
			`✖ pi-web-ui requires Node.js >= ${NODE_MIN.join(".")} (current: ${process.versions.node}).\n` +
			`  The pi SDK uses import attributes (\`with\` syntax) which older Node versions can't parse.\n` +
			`  Upgrade Node: https://nodejs.org then reinstall: npm i -g pi-web-ui`;
		console.error(isZhLang() ? zh : en);
		process.exit(1);
	}
}

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exit(1);
}

/** Run a command, inheriting stdio; exits on failure unless ignoreError. */
function run(cmd, args, { ignoreError = false, silent = false } = {}) {
	const res = spawnSync(cmd, args, {
		stdio: silent ? ["inherit", "ignore", "ignore"] : "inherit",
	});
	if (!ignoreError && res.status !== 0) process.exit(res.status ?? 1);
	return res;
}

/** Parse --flag value / --flag=value options; returns { opts, positionals }. */
function parseFlags(argv) {
	const opts = {
		port: undefined,
		cwd: undefined,
		dataDir: undefined,
		name: undefined,
		host: undefined,
		agentDir: undefined,
		print: false,
		noBrowser: false,
		force: false,
		checkUpdates: false,
		rollback: undefined,
		help: false,
	};
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const eq = a.indexOf("=");
		const key = eq >= 0 ? a.slice(0, eq) : a;
		const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
		const take = (flag) => {
			if (inline !== undefined) return inline;
			if (i + 1 < argv.length) {
				i++;
				return argv[i];
			}
			fail(`缺少选项 ${flag} 的值`);
		};
		switch (key) {
			case "--port":
				opts.port = take("--port");
				break;
			case "--cwd":
				opts.cwd = take("--cwd");
				break;
			case "--data-dir":
				opts.dataDir = take("--data-dir");
				break;
			case "--host":
				opts.host = take("--host");
				break;
			case "--agent-dir":
				opts.agentDir = take("--agent-dir");
				break;
			case "--name":
				opts.name = take("--name");
				break;
			case "--print":
				opts.print = true;
				break;
			case "--no-browser":
				opts.noBrowser = true;
				break;
			case "--force":
				opts.force = true;
				break;
			case "--check-updates":
				opts.checkUpdates = true;
				break;
			case "--rollback":
				opts.rollback = take("--rollback");
				break;
			case "--help":
			case "-h":
				opts.help = true;
				break;
			default:
				if (key.startsWith("-")) fail(`未知选项: ${key}`);
				positionals.push(a);
		}
	}
	return { opts, positionals };
}

// ---------------------------------------------------------------------------
// 前台启动
// ---------------------------------------------------------------------------

/** Open a URL in the OS default browser; failures are ignored (best-effort). */
function openBrowser(url) {
	let res;
	if (isMac) {
		res = spawnSync("open", [url], { stdio: "ignore" });
	} else if (isWin) {
		res = spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
	} else {
		res = spawnSync("xdg-open", [url], { stdio: "ignore" });
	}
	// spawnSync 不抛异常：命令缺失（headless 服务器）时在返回对象里带 error 字段。
	if (res?.error) {
		if (res.error.code === "ENOENT") {
			console.warn(
				`[browser] 未找到打开器 (${res.error.path || "command not found"})，` +
					"headless 服务器可用 --no-browser 关闭自动打开",
			);
		} else {
			console.warn("[browser] 打开浏览器失败:", res.error.message);
		}
	}
}

/**
 * Poll `url` until the server answers (or ~15s pass), then open it in the
 * default browser. The foreground server runs in this process, so the first
 * HTTP response is the "listening" signal; if the server crashes meanwhile
 * (e.g. port already taken), the pending timers die with the process and
 * nothing is opened.
 */
function openBrowserWhenUp(url) {
	const deadline = Date.now() + 15_000;
	const attempt = () => {
		const req = httpGet(url, (res) => {
			res.resume();
			console.log(`  🌐 已自动打开浏览器：${url}（--no-browser 可关闭）`);
			openBrowser(url);
		});
		req.setTimeout(1000, () => {
			req.destroy();
			if (Date.now() < deadline) setTimeout(attempt, 150);
		});
		req.on("error", () => {
			if (Date.now() < deadline) setTimeout(attempt, 150);
		});
	};
	attempt();
}

async function startForeground(opts) {
	if (opts.port) process.env.PI_WEB_PORT = opts.port;
	if (opts.cwd) process.env.PI_WEB_CWD = resolve(opts.cwd);
	if (opts.dataDir) process.env.PI_WEB_DATA_DIR = resolve(opts.dataDir);
	if (opts.host) process.env.PI_WEB_HOST = opts.host;
	if (opts.agentDir) process.env.PI_CODING_AGENT_DIR = resolve(opts.agentDir);
	const url = `http://localhost:${effectivePort(opts)}`;
	await import(pathToFileURL(SERVER_ENTRY).href);
	if (!opts.noBrowser) openBrowserWhenUp(url);
}

// ---------------------------------------------------------------------------
// 系统服务管理
// ---------------------------------------------------------------------------

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";

function uid() {
	try {
		return userInfo().uid;
	} catch {
		return process.getuid?.() ?? 501;
	}
}

/** launchd label / systemd unit name / Windows task name for a service name. */
function serviceLabel(name) {
	if (isMac) {
		return name === "pi-web-ui" ? "com.xingshuyin.pi-web-ui" : `com.${name}.server`;
	}
	return name;
}

function launchAgentPlist(name) {
	return join(homedir(), "Library", "LaunchAgents", `${serviceLabel(name)}.plist`);
}

function systemdUnitPath(name) {
	return `/etc/systemd/system/${name}.service`;
}

/** Windows: per-user config dir (%APPDATA%\pi-web-ui) holding the ps1/vbs launchers + pid file. */
function winServiceDir() {
	return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "pi-web-ui");
}

function winCmdPath(name) {
	return join(winServiceDir(), `${name}.cmd`);
}

function winPs1Path(name) {
	return join(winServiceDir(), `${name}.ps1`);
}

function winVbsPath(name) {
	return join(winServiceDir(), `${name}.vbs`);
}

function winTaskXmlPath(name) {
	return join(winServiceDir(), `${name}.xml`);
}

/** Windows log file (per service name — multiple services must not share one log). */
function winLogPath(name) {
	return join(homedir(), name === "pi-web-ui" ? "pi-web-ui.log" : `pi-web-ui-${name}.log`);
}

/** True when a scheduled task with this name exists (schtasks exits 0). */
function winTaskExists(name) {
	return spawnSync("schtasks", ["/Query", "/TN", name], { stdio: "ignore" }).status === 0;
}

/** Windows: per-user autostart registry key (HKCU — writable without admin). */
function winRunKeyName() {
	return "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
}

/** True when the per-user autostart Run key value exists. */
function winRunKeyInstalled(name) {
	return (
		spawnSync("reg", ["query", `HKCU\\${winRunKeyName()}`, "/v", name], {
			stdio: "ignore",
		}).status === 0
	);
}

/** Set the per-user autostart Run key value (no admin needed for HKCU). */
function winRunKeySet(name, value) {
	run("reg", ["add", `HKCU\\${winRunKeyName()}`, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], { silent: true });
}

/** Remove the per-user autostart Run key value (missing key is a no-op). */
function winRunKeyDelete(name) {
	run("reg", ["delete", `HKCU\\${winRunKeyName()}`, "/v", name, "/f"], { ignoreError: true, silent: true });
}

// ---------------------------------------------------------------------------
// 桌面快捷方式（server shortcut）
// ---------------------------------------------------------------------------

const SHORTCUT_LNK_NAME = "pi-web-ui.lnk"; // Windows 桌面快捷方式
const SHORTCUT_MAC_NAME = "pi-web-ui.command"; // macOS 双击启动器
const SHORTCUT_LINUX_NAME = "pi-web-ui.desktop"; // Linux 桌面图标

/** 快捷方式图标（品牌 .ico，随包发布；.lnk / .desktop 指向它）。 */
const APP_ICO_NAME = "pi-web-ui-logo.ico"; // 复制到用户目录后的稳定文件名（避开 pi-web-ui.ico —— Windows 对该路径有损坏的图标缓存残留，见 issue #xxx）
const APP_ICO_SOURCE = join(BIN_DIR, "..", "web", "public", "icon.ico"); // Dispatch artwork, 7 frames (16–256px) for desktop/taskbar density.
/** Branded opaque desktop SVG (source of truth: web/public/desktop-icon.svg) — used on Linux. */
const APP_SVG_PACKAGE = join(BIN_DIR, "..", "web", "public", "desktop-icon.svg");

/** Windows: per-user copy of the branded .ico (stable path for the .lnk icon). */
function winIcoPath() {
	return join(winServiceDir(), APP_ICO_NAME);
}

/** Full path to Windows PowerShell 5.1. */
function winPowershell() {
	return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Full path to wscript.exe — a console-free host (no conhost window, so no black
 * console box ever appears in the taskbar on double-click). Used as the .lnk target;
 * it launches the .ps1 hidden via a thin VBS launcher. */
function winWscript() {
	return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");
}

/**
 * Resolve the real node binary. fnm/volta/nvm shims (e.g. fnm_multishells)
 * point into temp dirs that vanish when the installing shell exits — the
 * baked-in launcher scripts must use the stable real path instead.
 */
function realNode() {
	try {
		return realpathSync(process.execPath);
	} catch {
		return process.execPath;
	}
}

/** Windows: launcher ps1 the desktop .lnk runs (hidden). */
function winShortcutPs1Path(name) {
	return join(winServiceDir(), `${name}-shortcut.ps1`);
}

/** Windows: launcher vbs the desktop .lnk actually runs (wscript.exe, console-free). */
function winShortcutVbsPath(name) {
	return join(winServiceDir(), `${name}-shortcut.vbs`);
}

/** Windows: PID file of a shortcut-started (no scheduled task) instance. */
function winPidFilePath(name) {
	return join(winServiceDir(), `${name}.pid`);
}

/** Read the recorded PID of a shortcut-started Windows instance. */
function winReadPid(name) {
	try {
		const pid = Number(readFileSync(winPidFilePath(name), "utf8").trim());
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

/** True when a PID exists (signal 0; EPERM means exists but not ours). */
function pidAlive(pid) {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === "EPERM";
	}
}

/** Single-quote a string for embedding in a POSIX shell script. */
function shQuote(s) {
	return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/**
 * Windows shortcut launcher. Double-click the .lnk → this script runs hidden:
 * server already up → just open the browser; autostart service installed
 * (HKCU Run key + wscript/VBS launcher) → start it (manageable via `server
 * stop`); otherwise run the server in the foreground of this hidden window and
 * record its PID so `server stop` / `server uninstall` can terminate it too.
 */
function buildWinShortcutPs1(env, cwd, taskName, url, logPath, pidPath) {
	const sets = Object.entries(env)
		.map(([k, v]) => `$env:${k} = ${psQuote(v)}`)
		.join("\r\n");
	const node = realNode();
	return [
		"# Generated by: pi-web-ui server shortcut (rerun to change)",
		"# Runs hidden from the desktop shortcut: if the server is already up it",
		"# opens the browser; the autostart service (if installed) is started;",
		"# otherwise the server runs in the foreground of this hidden window and",
		"# its PID is recorded so `server stop` / `server uninstall` can stop it.",
		"$ErrorActionPreference = 'Continue'",
		`$url = ${psQuote(url)}`,
		`$health = ${psQuote(url + "/api/health")}`,
		`$svcName = ${psQuote(taskName)}`,
		`$pidFile = ${psQuote(pidPath)}`,
		`$log = ${psQuote(logPath)}`,
		"",
		"function Test-Up {",
		"  try { return (Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }",
		"}",
		"function Open-Browser { Start-Process $url | Out-Null }",
		"",
		"# 已在运行 → 直接打开浏览器",
		"if (Test-Up) { Open-Browser; exit 0 }",
		"",
		"# 已安装自启服务（HKCU Run 键 + wscript 隐藏启动）→ 走服务启动（server stop 可管理）",
		"$vbs = Join-Path $env:APPDATA ('pi-web-ui\\' + $svcName + '.vbs')",
		"if (Test-Path $vbs) {",
		"  wscript.exe $vbs",
		"  for ($i = 0; $i -lt 120; $i++) {",
		"    Start-Sleep -Milliseconds 250",
		"    if (Test-Up) { Open-Browser; exit 0 }",
		"  }",
		"  Write-Host ('✖ pi-web-ui 服务未在 30 秒内就绪，请查看日志: ' + $log)",
		"  exit 1",
		"}",
		"",
		"# 未安装服务 → 在本隐藏窗口中前台运行（记录 PID，server stop 可停止）",
		`$PID | Out-File -Encoding ascii $pidFile`,
		sets,
		`Set-Location ${psQuote(cwd)}`,
		"# 后台轮询，就绪后打开浏览器（与前台 node 并行）",
		"$job = Start-Job -ScriptBlock { param($u)",
		"  $h = $u + '/api/health'",
		"  for ($i = 0; $i -lt 120; $i++) {",
		"    Start-Sleep -Milliseconds 250",
		"    try { if ((Invoke-WebRequest -Uri $h -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $u | Out-Null; break } } catch {}",
		"  }",
		"} -ArgumentList $url",
		`& ${psQuote(node)} ${psQuote(SERVER_ENTRY)} *>> $log`,
		"Remove-Item $pidFile -ErrorAction SilentlyContinue",
		"",
	].join("\r\n");
}

/**
 * Build the tiny VBS launcher that starts a .ps1 *without* creating any console
 * host: wscript.exe has no console, and WScript.Shell.Run(…, 0, False) launches
 * the child hidden and returns at once (0 = hidden window, False = don't wait).
 * Used by both the desktop .lnk and the logon autostart service. Note:
 * `powershell -WindowStyle Hidden` alone is unreliable when Windows itself
 * spawns the process (Task Scheduler) — the console window can still show;
 * this launcher never creates one at all.
 */
function buildWinHiddenVbs(ps1Path) {
	const cmd = `${winPowershell()} -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps1Path}"`;
	// VBScript 字符串没有 \" 转义（也没有 \uXXXX），内嵌引号必须写成 ""；
	// 不能用 JSON.stringify —— 它输出 \" 会在 VBScript 里提前结束字符串（语句未结束 800A0401），
	// 且会把非 ASCII 路径转成 \uXXXX 字面量（wscript 不识别，中文用户名直接变成乱码路径）。
	const vbsCmd = cmd.replace(/"/g, '""');
	return [
		"Option Explicit",
		"Dim sh, cmd",
		'Set sh = CreateObject("WScript.Shell")',
		`cmd = "${vbsCmd}"`,
		"sh.Run cmd, 0, False",
		"Set sh = Nothing",
		"",
	].join("\r\n");
}

/**
 * Create the Windows desktop .lnk via WScript.Shell COM (correct Desktop path
 * even with OneDrive redirection). Target is powershell.exe with
 * -WindowStyle Hidden so nothing flashes on double-click.
 */
function installWinShortcut(opts) {
	const { name, port, cwd, dataDir, host, agentDir } = serviceOptions(opts);
	const env = serviceEnv(port, cwd, dataDir, host, agentDir);
	const url = `http://localhost:${port}`;
	const ps1Path = winShortcutPs1Path(name);
	const ps1 = buildWinShortcutPs1(env, cwd, name, url, winLogPath(name), winPidFilePath(name));
	if (opts.print) {
		console.log(`# ${ps1Path}\n${ps1}`);
		return;
	}
	mkdirSync(dirname(ps1Path), { recursive: true });
	writeFileSync(ps1Path, "\uFEFF" + ps1, "utf8"); // PS 5.1 需要 BOM
	// wscript host + VBS launcher: no console window / taskbar black box on double-click.
	const vbsPath = winShortcutVbsPath(name);
	writeFileSync(vbsPath, "\uFEFF" + buildWinHiddenVbs(ps1Path), "utf16le"); // wscript 只认 UTF-16/ANSI，UTF-8 BOM 会报“无效字符”，中文路径用 utf16le + BOM
	// 把品牌图标准备好：复制到用户目录（.lnk 图标指向稳定路径）
	if (existsSync(APP_ICO_SOURCE)) {
		copyFileSync(APP_ICO_SOURCE, winIcoPath());
	} else {
		console.log(`⚠ 未找到品牌图标 ${APP_ICO_SOURCE}，快捷方式将使用默认图标`);
	}
	const powershell = winPowershell();
	const ps = [
		"$ErrorActionPreference = 'Stop'",
		"$ws = New-Object -ComObject WScript.Shell",
		"$desktop = [Environment]::GetFolderPath('Desktop')",
		`$lnk = $ws.CreateShortcut((Join-Path $desktop ${psQuote(SHORTCUT_LNK_NAME)}))`,
		`$lnk.TargetPath = ${psQuote(winWscript())}`,
		`$lnk.Arguments = ${psQuote(vbsPath)}`,
		`$lnk.WorkingDirectory = ${psQuote(cwd)}`,
		"$lnk.Description = 'pi-web-ui — 双击启动服务并打开浏览器'",
		`$lnk.IconLocation = ${psQuote(winIcoPath())} + ',0'`,
		"$lnk.Save()",
		`Write-Output (Join-Path $desktop ${psQuote(SHORTCUT_LNK_NAME)})`,
	].join("\r\n");
	const res = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
		encoding: "utf8",
	});
	if (res.status !== 0) {
		fail(`创建桌面快捷方式失败: ${(res.stderr || res.stdout || "").trim()}`);
	}
	const lnk = (res.stdout ?? "").trim();
	console.log(`✅ 已创建桌面快捷方式: ${lnk}`);
	console.log(`   双击 : 服务未运行则启动（隐藏窗口，无黑窗），就绪后自动打开浏览器`);
	console.log(`   停止 : pi-web-ui server stop（快捷方式启动的实例也会一并停止）`);
	console.log(`   端口 : ${port}`);
	console.log(`   目录 : ${cwd}`);
}

/** macOS: double-clickable .command launcher (the .lnk equivalent). */
function buildMacShortcut(label, plist, url, env) {
	const exports = Object.entries(env)
		.map(([k, v]) => `export ${k}=${shQuote(v)}`)
		.join("\n");
	const node = realNode();
	return `#!/bin/bash
# pi-web-ui 启动器 — generated by: pi-web-ui server shortcut
# 双击运行：确保服务在运行，然后打开浏览器。
#   · 已安装 launchd 服务（登录自启）→ kickstart，图标主要用于「启动 + 打开」
#   · 未安装服务 → 在本终端前台运行（关闭窗口即停止）
LABEL=${shQuote(label)}
PLIST=${shQuote(plist)}
URL=${shQuote(url)}
LOG=/tmp/pi-web-ui-shortcut.log
NODE=${shQuote(node)}
ENTRY=${shQuote(SERVER_ENTRY)}
${exports}

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart "gui/$(id -u)/$LABEL"
elif [ -f "$PLIST" ]; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
else
  # 未安装服务：在本终端前台运行服务器（关闭窗口即停止）
  "$NODE" "$ENTRY" >>"$LOG" 2>&1 &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
fi

# 等服务就绪后打开浏览器（最多约 30 秒）
for i in $(seq 1 120); do
  curl -sf "$URL/api/health" >/dev/null 2>&1 && break
  sleep 0.25
done
open "$URL"
if [ -n "\${SERVER_PID:-}" ]; then wait "$SERVER_PID"; fi
`;
}

function installMacShortcut(opts) {
	const { name, port, cwd, dataDir, host, agentDir } = serviceOptions(opts);
	const url = `http://localhost:${port}`;
	const script = buildMacShortcut(
		serviceLabel(name),
		launchAgentPlist(name),
		url,
		serviceEnv(port, cwd, dataDir, host, agentDir),
	);
	const path = join(homedir(), "Desktop", SHORTCUT_MAC_NAME);
	if (opts.print) {
		console.log(`# ${path}\n${script}`);
		return;
	}
	writeFileSync(path, script);
	chmodSync(path, 0o755);
	console.log(`✅ 已创建桌面启动器: ${path}`);
	console.log(`   双击 : 确保服务运行并打开浏览器；未安装服务时在本终端前台运行`);
	console.log(`   说明 : macOS 没有 Windows 式快捷方式，这是等价的 .command 启动器；`);
	console.log(`          launchd 服务登录自启，图标主要用于快速「启动 + 打开浏览器」`);
	console.log(`   端口 : ${port}`);
	console.log(`   目录 : ${cwd}`);
}

/** Linux: launcher script run by the .desktop icon. */
function buildLinuxStartScript(unitName, url) {
	const log = join(homedir(), ".local", "share", "pi-web-ui", "pi-web-ui.log");
	const node = realNode();
	return `#!/bin/bash
# pi-web-ui 启动器 — generated by: pi-web-ui server shortcut
# 双击运行：确保服务在运行，然后打开浏览器。
#   · systemd 单元已安装 → systemctl start（系统单元需要授权，失败则前台运行）
#   · 未安装 → 在本进程前台运行（终端关闭即停止）
LOG=${shQuote(log)}
URL=${shQuote(url)}
NODE=${shQuote(node)}
ENTRY=${shQuote(SERVER_ENTRY)}
UNIT=${shQuote(unitName)}.service

if ! curl -sf "$URL/api/health" >/dev/null 2>&1; then
  systemctl start "$UNIT" 2>/dev/null || true
  if ! curl -sf "$URL/api/health" >/dev/null 2>&1; then
    mkdir -p "$(dirname "$LOG")"
    "$NODE" "$ENTRY" >>"$LOG" 2>&1 &
    SERVER_PID=$!
    trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
  fi
fi

for i in $(seq 1 120); do
  curl -sf "$URL/api/health" >/dev/null 2>&1 && break
  sleep 0.25
done
xdg-open "$URL" >/dev/null 2>&1 &
if [ -n "\${SERVER_PID:-}" ]; then wait "$SERVER_PID"; fi
`;
}

function installLinuxShortcut(opts) {
	const { name, port, cwd, dataDir, host, agentDir } = serviceOptions(opts);
	const url = `http://localhost:${port}`;
	const scriptDir = join(homedir(), ".local", "share", "pi-web-ui");
	const scriptPath = join(scriptDir, `${name}-start.sh`);
	const desktopPath = join(homedir(), "Desktop", SHORTCUT_LINUX_NAME);
	const icoPath = join(scriptDir, APP_ICO_NAME); // 备用；优先 SVG
	const svgPath = join(scriptDir, "pi-web-ui.svg");
	const script = buildLinuxStartScript(name, url);
	const desktopIcon = existsSync(APP_SVG_PACKAGE) ? svgPath : APP_ICO_NAME;
	const desktop = `[Desktop Entry]
Version=1.0
Type=Application
Name=pi-web-ui
Comment=启动 pi-web-ui 服务并打开浏览器
Exec=${shQuote(scriptPath)}
Icon=${shQuote(desktopIcon)}
Terminal=false
Categories=Network;WebBrowser;
`;
	if (opts.print) {
		console.log(`# ${scriptPath}\n${script}`);
		console.log(`# ${desktopPath}\n${desktop}`);
		return;
	}
	mkdirSync(scriptDir, { recursive: true });
	// 品牌图标（缺失时跳过，桌面自动回退默认图标）
	if (existsSync(APP_SVG_PACKAGE)) copyFileSync(APP_SVG_PACKAGE, svgPath);
	else if (existsSync(APP_ICO_SOURCE)) copyFileSync(APP_ICO_SOURCE, icoPath);
	writeFileSync(scriptPath, script);
	chmodSync(scriptPath, 0o755);
	writeFileSync(desktopPath, desktop);
	chmodSync(desktopPath, 0o755);
	// GNOME 需要标记可信才能双击运行
	run("gio", ["set", desktopPath, "metadata::trusted", "true"], {
		ignoreError: true,
		silent: true,
	});
	console.log(`✅ 已创建桌面图标: ${desktopPath}`);
	console.log(`   GNOME 若提示「不受信任的应用程序」，右键选择 Allow Launching`);
	console.log(`   端口 : ${port}`);
	console.log(`   目录 : ${cwd}`);
}

/** Remove desktop shortcut artifacts created by `server shortcut`. */
function removeShortcut(name) {
	if (isWin) {
		for (const f of [winShortcutPs1Path(name), winShortcutVbsPath(name), winPidFilePath(name), winIcoPath()]) {
			if (existsSync(f)) rmSync(f);
		}
		spawnSync(
			winPowershell(),
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				`$d=[Environment]::GetFolderPath('Desktop');$p=Join-Path $d ${psQuote(SHORTCUT_LNK_NAME)};if(Test-Path $p){Remove-Item $p -Force}`,
			],
			{ stdio: "ignore" },
		);
	} else if (isMac) {
		const p = join(homedir(), "Desktop", SHORTCUT_MAC_NAME);
		if (existsSync(p)) rmSync(p);
	} else if (isLinux) {
		const p = join(homedir(), "Desktop", SHORTCUT_LINUX_NAME);
		if (existsSync(p)) rmSync(p);
		rmSync(join(homedir(), ".local", "share", "pi-web-ui"), {
			recursive: true,
			force: true,
		});
	}
}

/** Single-quote a string for embedding in a generated PowerShell script. */
function psQuote(s) {
	return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Build the PowerShell launcher the autostart service runs. Windows never sees
 * a console from it: the HKCU Run key launches wscript.exe → VBS → powershell
 * (hidden), so no black box can appear. The script sets the env, cd's to the
 * workspace, records its PID to <name>.pid (for `server stop`), then runs node
 * inside a watchdog loop — if node exits, it restarts after 10s (same
 * philosophy as launchd KeepAlive / systemd Restart=always). `server stop`
 * force-kills the recorded PID tree, which takes the loop down with it.
 */
function buildWinStartPs1(env, cwd, logPath, pidPath) {
	const sets = Object.entries(env)
		.map(([k, v]) => `$env:${k} = ${psQuote(v)}`)
		.join("\r\n");
	return [
		"# Generated by: pi-web-ui server install (rerun to change)",
		"# Runs the server with no console window (wscript+VBS launcher) and",
		"# restarts it if it crashes (watchdog, like launchd/systemd).",
		sets,
		`Set-Location ${psQuote(cwd)}`,
		`$PID | Out-File -Encoding ascii ${psQuote(pidPath)}`,
		"try {",
		"  while ($true) {",
		`    & ${psQuote(realNode())} ${psQuote(SERVER_ENTRY)} *>> ${psQuote(logPath)}`,
		"    Start-Sleep 10",
		"  }",
		"} finally {",
		`  Remove-Item ${psQuote(pidPath)} -ErrorAction SilentlyContinue`,
		"}",
		"",
	].join("\r\n");
}

function esc(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Start the autostart service now: wscript runs the VBS hidden and exits at once. */
function launchWinService(vbsPath) {
	const child = spawn(winWscript(), [vbsPath], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
}

/** Kill a running Windows instance via its PID file (whole tree). */
function stopWinInstance(name) {
	const pid = winReadPid(name);
	if (pid) {
		if (pidAlive(pid)) {
			run("taskkill", ["/PID", String(pid), "/T", "/F"], {
				ignoreError: true,
				silent: true,
			});
			// taskkill /F 异步生效：等到进程树真正退出（restart 需要避免端口竞争）
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline && pidAlive(pid)) {
				spawnSync("ping", ["-n", "2", "127.0.0.1"], { stdio: "ignore" });
			}
		}
		rmSync(winPidFilePath(name), { force: true });
	}
}

/** Build the launchd plist XML. */
function buildPlist(label, cwd, env) {
	const entries = Object.entries(env)
		.map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Generated by: pi-web-ui server install (do not edit by hand — rerun to change) -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(label)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${esc(NODE)}</string>
    <string>${esc(SERVER_ENTRY)}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <!-- Restart if it crashes -->
  <key>KeepAlive</key>
  <true/>

  <key>WorkingDirectory</key>
  <string>${esc(cwd)}</string>

  <key>EnvironmentVariables</key>
  <dict>
${entries}
  </dict>

  <key>StandardOutPath</key>
  <string>/tmp/pi-web-ui.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/pi-web-ui.err</string>
</dict>
</plist>
`;
}

/** Build the systemd unit file. */
function buildUnit(cwd, env) {
	const envLines = Object.entries(env)
		.map(([k, v]) => `Environment=${k}=${v}`)
		.join("\n");
	return `# Generated by: pi-web-ui server install (do not edit by hand — rerun to change)
[Unit]
Description=pi-web-ui — web chat for the pi coding agent
After=network.target

[Service]
Type=simple
User=${process.env.SUDO_USER ?? userInfo().username}
WorkingDirectory=${cwd}
${envLines}
ExecStart=${JSON.stringify(NODE)} ${JSON.stringify(SERVER_ENTRY)}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

/** If not root on Linux, re-exec the same server command through sudo. */
function ensureRootForSystemctl() {
	if (typeof process.getuid === "function" && process.getuid() === 0) return;
	// process.argv = [node, <bin>, "server", <action>, ...rest] — forward
	// everything after "server" so flags like --port/--cwd survive.
	const res = spawnSync("sudo", [NODE, fileURLToPath(import.meta.url), "server", ...process.argv.slice(3)], {
		stdio: "inherit",
	});
	process.exit(res.status ?? 1);
}

/** Resolve the effective HTTP port: --port > $PI_WEB_PORT > 8787. */
function effectivePort(opts) {
	return String(opts.port ?? process.env.PI_WEB_PORT ?? "8787");
}

/** Shared option normalization for install. */
function serviceOptions(opts) {
	const name = opts.name ?? "pi-web-ui";
	const port = effectivePort(opts);
	if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
		fail(`无效端口: ${port}`);
	}
	// 服务默认以用户主目录为工作目录：安装命令的当前目录不可靠（例如 Windows 提权提示符
	// 默认在 C:\WINDOWS\system32），主目录跨平台可预期；前台启动仍默认当前目录。
	const cwd = resolve(opts.cwd ?? process.env.PI_WEB_CWD ?? homedir());
	if (!existsSync(cwd)) fail(`工作目录不存在: ${cwd}`);
	let dataDir;
	if (opts.dataDir) {
		dataDir = resolve(opts.dataDir);
	} else if (process.env.PI_WEB_DATA_DIR) {
		dataDir = resolve(process.env.PI_WEB_DATA_DIR);
	}
	// 引擎/监听地址/agent 配置目录：flag 优先，环境变量后备（token 不走命令行，仅环境变量）。
	const host = opts.host ?? process.env.PI_WEB_HOST;
	const agentDir = opts.agentDir ? resolve(opts.agentDir) : process.env.PI_CODING_AGENT_DIR;
	return { name, port, cwd, dataDir, host, agentDir };
}

function serviceEnv(port, cwd, dataDir, host, agentDir, service = {}) {
	const env = {
		PI_WEB_PORT: port,
		PI_WEB_CWD: cwd,
	};
	// 启动来源标记（见 server/launch-origin.ts）：只有真正被平台服务管理器托管的
	// 启动器才写。桌面快捷方式 / .command 在「未安装服务」时是前台跑（退出不回来），
	// 不能带这个标记，所以它们不传 service。已装好的老服务没有这两个变量，服务端
	// 仍能靠运行时判据（XPC_SERVICE_NAME / INVOCATION_ID / PID 文件）认出来。
	if (service.name) {
		env.PI_WEB_LAUNCHED_BY = "service";
		env.PI_WEB_SERVICE_NAME = service.name;
	}
	// Interactive Windows tasks inherit the user's PATH; only systemd/launchd
	// run with a minimal environment that needs an explicit PATH.
	if (!isWin) env.PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
	// Same for the locale: launchd/systemd drop LANG/LC_ALL, and a C-locale
	// shell garbles multibyte input in the terminal (UTF-8 continuation
	// bytes 0x80–0x9F rendered as C1 control chars). Bake the installing
	// shell's locale into the service env so spawned terminals are UTF-8.
	if (!isWin && process.env.LANG) env.LANG = process.env.LANG;
	if (!isWin && process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
	if (dataDir) env.PI_WEB_DATA_DIR = dataDir;
	if (host) env.PI_WEB_HOST = host;
	if (agentDir) env.PI_CODING_AGENT_DIR = agentDir;
	return env;
}

function installLaunchd(opts) {
	const { name, port, cwd, dataDir, host, agentDir } = serviceOptions(opts);
	const label = serviceLabel(name);
	const plist = launchAgentPlist(name);
	const content = buildPlist(label, cwd, serviceEnv(port, cwd, dataDir, host, agentDir, { name }));
	if (opts.print) {
		console.log(`# ${plist}\n${content}`);
		return;
	}
	// Unload any existing instance (ignore "not loaded"), then (re)install.
	run("launchctl", ["bootout", `gui/${uid()}/${label}`], {
		ignoreError: true,
		silent: true,
	});
	mkdirSync(dirname(plist), { recursive: true });
	writeFileSync(plist, content);
	run("launchctl", ["bootstrap", `gui/${uid()}`, plist]);
	console.log(`✅ 已安装并启动 launchd 服务 ${label}`);
	console.log(`   端口 : ${port}`);
	console.log(`   目录 : ${cwd}`);
	console.log(`   访问 : http://localhost:${port}`);
	console.log(`   日志 : /tmp/pi-web-ui.log  /tmp/pi-web-ui.err`);
	console.log(`   管理 : pi-web-ui server status|restart|stop|uninstall`);
	console.log(`   提示 : pi-web-ui server shortcut 可在桌面创建「一键启动」图标`);
}

function installSystemd(opts) {
	const { name, port, cwd, dataDir, host, agentDir } = serviceOptions(opts);
	const content = buildUnit(cwd, serviceEnv(port, cwd, dataDir, host, agentDir, { name }));
	const unitPath = systemdUnitPath(name);
	if (opts.print) {
		console.log(`# ${unitPath}\n${content}`);
		return;
	}
	ensureRootForSystemctl();
	writeFileSync(unitPath, content);
	run("systemctl", ["daemon-reload"]);
	run("systemctl", ["enable", "--now", `${name}.service`]);
	console.log(`✅ 已安装并启动 systemd 服务 ${name}.service`);
	console.log(`   端口 : ${port}`);
	console.log(`   目录 : ${cwd}`);
	console.log(`   访问 : http://localhost:${port}`);
	console.log(`   日志 : journalctl -u ${name}.service -f`);
	console.log(`   管理 : pi-web-ui server status|restart|stop|uninstall`);
	console.log(`   提示 : pi-web-ui server shortcut 可在桌面创建「一键启动」图标`);
}

function uninstallLaunchd(opts) {
	const name = opts.name ?? "pi-web-ui";
	const label = serviceLabel(name);
	const plist = launchAgentPlist(name);
	run("launchctl", ["bootout", `gui/${uid()}/${label}`], {
		ignoreError: true,
		silent: true,
	});
	if (existsSync(plist)) rmSync(plist);
	removeShortcut(name);
	console.log(`🗑  已卸载 ${label}（plist 已删除，不再开机自启）`);
	console.log(`🗑  已移除桌面快捷方式`);
}

function uninstallSystemd(opts) {
	const name = opts.name ?? "pi-web-ui";
	ensureRootForSystemctl();
	run("systemctl", ["disable", "--now", `${name}.service`], {
		ignoreError: true,
	});
	const unitPath = systemdUnitPath(name);
	if (existsSync(unitPath)) rmSync(unitPath);
	run("systemctl", ["daemon-reload"]);
	removeShortcut(name);
	console.log(`🗑  已卸载 ${name}.service（不再开机自启）`);
	console.log(`🗑  已移除桌面快捷方式`);
}

function installWindows(opts) {
	const { name, port, cwd, dataDir, host, agentDir } = serviceOptions(opts);
	const env = serviceEnv(port, cwd, dataDir, host, agentDir, { name });
	const ps1Path = winPs1Path(name);
	const vbsPath = winVbsPath(name);
	const pidPath = winPidFilePath(name);
	const ps1 = buildWinStartPs1(env, cwd, winLogPath(name), pidPath);
	const vbs = buildWinHiddenVbs(ps1Path);
	// HKCU Run 键值：wscript.exe 以隐藏方式启动 VBS（无控制台，登录后自启）
	const runValue = `"${winWscript()}" "${vbsPath}"`;
	if (opts.print) {
		console.log(`# ${ps1Path}\n${ps1}`);
		console.log(`# ${vbsPath}\n${vbs}`);
		console.log(`# 登录自启（HKCU Run 键，无需管理员）`);
		console.log(`  reg add "HKCU\\${winRunKeyName()}" /v ${name} /t REG_SZ /d "${runValue}" /f`);
		return;
	}
	mkdirSync(dirname(ps1Path), { recursive: true });
	// UTF-8 with BOM: Windows PowerShell 5.1 misreads BOM-less UTF-8 as ANSI.
	writeFileSync(ps1Path, "\uFEFF" + ps1, "utf8");
	// wscript host + VBS launcher: no console window / taskbar black box ever.
	writeFileSync(vbsPath, "\uFEFF" + vbs, "utf16le"); // wscript 只认 UTF-16/ANSI，UTF-8 BOM 会报“无效字符”
	// 迁移：移除旧版 .cmd 包装与历史计划任务（普通用户下 schtasks 无法创建，改为 Run 键）。
	if (existsSync(winCmdPath(name))) rmSync(winCmdPath(name));
	if (winTaskExists(name)) {
		run("schtasks", ["/End", "/TN", name], {
			ignoreError: true,
			silent: true,
		});
		// /End 异步生效：稍候再删任务，避免新实例与旧实例端口竞争
		spawnSync("ping", ["-n", "2", "127.0.0.1"], { stdio: "ignore" });
		run("schtasks", ["/Delete", "/TN", name, "/F"], {
			ignoreError: true,
			silent: true,
		});
	}
	winRunKeySet(name, runValue);
	launchWinService(vbsPath);
	console.log(`✅ 已安装并启动 ${name}（登录自启 · HKCU Run 键 · 无需管理员）`);
	console.log(`   窗口 : wscript 隐藏启动，无黑窗`);
	console.log(`   端口 : ${port}`);
	console.log(`   目录 : ${cwd}`);
	console.log(`   访问 : http://localhost:${port}`);
	console.log(`   日志 : ${winLogPath(name)}`);
	console.log(`   说明 : 崩溃后 10 秒自动重启（看门狗）；stop 停止，uninstall 移除`);
	console.log(`   管理 : pi-web-ui server status|restart|stop|uninstall`);
	console.log(`   提示 : pi-web-ui server shortcut 可在桌面创建「一键启动」图标`);
}

function uninstallWindows(opts) {
	const name = opts.name ?? "pi-web-ui";
	winRunKeyDelete(name);
	// 历史计划任务（旧版本 install 可能注册过）
	if (winTaskExists(name)) {
		run("schtasks", ["/Delete", "/TN", name, "/F"], { ignoreError: true });
	}
	// 运行中的实例（服务或快捷方式启动，均记录 PID 文件）
	stopWinInstance(name);
	for (const f of [winCmdPath(name), winPs1Path(name), winVbsPath(name), winTaskXmlPath(name)]) {
		if (existsSync(f)) rmSync(f);
	}
	removeShortcut(name);
	console.log(`🗑  已卸载 ${name}（登录自启已移除，不再开机自启）`);
	console.log(`🗑  已移除桌面快捷方式`);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Local control socket (status / quiesce / unquiesce). The server listens on
// a mode-0600 Unix socket (POSIX) or a named pipe (Windows) under its data
// dir; same path rules as server/control-socket.ts so the CLI and server
// always agree without sharing code.
// ---------------------------------------------------------------------------

/** Resolve the control socket path for the given options. */
function controlPath(opts) {
	const dir = opts.dataDir
		? resolve(opts.dataDir)
		: process.env.PI_WEB_DATA_DIR
			? resolve(process.env.PI_WEB_DATA_DIR)
			: join(homedir(), ".pi-web");
	return isWin ? `\\\\.\\pipe\\pi-web-ui-${effectivePort(opts)}` : join(dir, "pi-web-ui.sock");
}

/** Send one control command to a RUNNING server; resolves null if unreachable. */
function controlCommand(opts, cmd) {
	const path = controlPath(opts);
	return new Promise((resolvePromise) => {
		const sock = createConnection(path);
		let done = false;
		const finish = (v) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			sock.destroy();
			resolvePromise(v);
		};
		const timer = setTimeout(() => finish(null), 3000);
		let buf = "";
		sock.on("connect", () => sock.write(JSON.stringify({ cmd }) + "\n"));
		sock.on("data", (chunk) => {
			buf += chunk.toString("utf8");
			const nl = buf.indexOf("\n");
			if (nl >= 0) {
				try {
					finish(JSON.parse(buf.slice(0, nl)));
				} catch {
					finish(null);
				}
			}
		});
		sock.on("error", () => finish(null));
		sock.on("close", () => finish(null));
	});
}

/** Append the live server status (via the control socket) to `server status`. */
async function printLiveStatus(opts) {
	const st = await controlCommand(opts, "status");
	if (!st || !st.ok) {
		console.log("   (服务器未运行或控制通道不可达 — 启动后可查 server status 实时信息)");
		return;
	}
	console.log("   --- 实时状态 (control socket) ---");
	console.log(`   版本 : ${st.version} · PID ${st.pid}`);
	console.log(`   目录 : ${st.cwd}`);
	// 启动来源（server/launch-origin.ts）：有 supervisor = 这个进程退出后会被自动
	// 拉起（server restart / 更新面板的「重启服务」才有意义）。
	console.log(
		`   启动 : ${
			st.service
				? `pi-web-ui 服务（${st.service.supervisor} · ${st.service.name}）`
				: "前台 / 开发模式（无 supervisor，退出不自动重启）"
		}`,
	);
	console.log(`   排空 : ${st.quiesced ? `是（自 ${new Date(st.quiescedSince).toLocaleString()}）` : "否"}`);
	console.log(
		`   连接 : ${st.connectedClients} 个浏览器 · ${st.activeConversations} 个运行中对话 · ${st.pendingMessages} 条排队消息`,
	);
}

/** `server quiesce|unquiesce` — toggle the admission gate on a RUNNING server. */
async function setQuiesce(opts, on) {
	const st = await controlCommand(opts, on ? "quiesce" : "unquiesce");
	if (!st || !st.ok) {
		fail(`服务器未运行或控制通道不可达（${controlPath(opts)}）`);
	}
	console.log(
		on
			? "⏸  已进入排空模式（quiesce）：拒绝新的对话/消息/编辑，存量运行继续跑完。\n" +
					"    跑完后用 pi-web-ui server unquiesce 恢复。"
			: "▶  已解除排空模式（unquiesce）：恢复接收新的对话/消息/编辑。",
	);
}

function controlService(action, opts) {
	const name = opts.name ?? "pi-web-ui";

	if (isMac) {
		const label = serviceLabel(name);
		const target = `gui/${uid()}/${label}`;
		const loaded = () => spawnSync("launchctl", ["print", target], { stdio: "ignore" }).status === 0;

		if (action === "status") {
			if (loaded()) {
				const res = spawnSync("launchctl", ["print", target], {
					encoding: "utf8",
				});
				const state = (res.stdout.match(/state = (\w+)/) ?? [])[1] ?? "loaded";
				console.log(`${label}: ${state}（已加载，开机自启中）`);
			} else {
				console.log(`${label}: 未安装（运行 pi-web-ui server install 安装）`);
			}
			return;
		}

		if (action === "start") {
			if (loaded()) {
				run("launchctl", ["kickstart", target]);
			} else {
				const plist = launchAgentPlist(name);
				if (!existsSync(plist)) {
					fail(`找不到 ${plist}，请先运行 pi-web-ui server install`);
				}
				run("launchctl", ["bootstrap", `gui/${uid()}`, plist]);
			}
			console.log(`✅ 已启动 ${label}`);
			return;
		}

		if (action === "restart") {
			if (!loaded()) fail(`${label} 未加载，请先 pi-web-ui server start`);
			run("launchctl", ["kickstart", "-k", target]);
			console.log(`✅ 已重启 ${label}`);
			return;
		}

		if (action === "stop") {
			run("launchctl", ["bootout", target], {
				ignoreError: true,
				silent: true,
			});
			console.log(`⏹  已停止 ${label}（已卸载，不再开机自启；start 恢复）`);
			return;
		}

		fail(`未知操作: ${action}`);
	}

	if (isLinux) {
		ensureRootForSystemctl();
		if (action === "status") {
			run("systemctl", ["status", `${name}.service`, "--no-pager"]);
			return;
		}
		run("systemctl", [action, `${name}.service`]);
		console.log(`✅ ${action} ${name}.service`);
		return;
	}

	if (isWin) {
		const installed = winRunKeyInstalled(name);
		const legacy = !installed && winTaskExists(name); // 旧版计划任务安装（未迁移）

		if (action === "status") {
			const pid = winReadPid(name);
			const instAlive = pid && pidAlive(pid);
			if (legacy) {
				console.log(`${name}: 旧版计划任务安装（未迁移）`);
				console.log(`   提示 : 重新执行 server install 可迁移到登录自启模式（删除任务，无需管理员）`);
				if (instAlive) console.log(`   实例 : 运行中 (PID ${pid})`);
				return;
			}
			if (!installed) {
				console.log(`${name}: 未安装（运行 pi-web-ui server install 安装）`);
				if (instAlive) console.log(`   快捷方式实例 : 运行中 (PID ${pid})`);
				return;
			}
			console.log(`${name}: 已安装（登录自启 · HKCU Run 键 · wscript 隐藏启动，无黑窗）`);
			if (instAlive) {
				console.log(`   运行状态 : 运行中 (PID ${pid})`);
				console.log(`   日志 : ${winLogPath(name)}`);
			} else {
				console.log(`   运行状态 : 未运行（pi-web-ui server start 启动）`);
			}
			return;
		}

		if (action === "start") {
			if (legacy) {
				run("schtasks", ["/Run", "/TN", name]);
				console.log(`✅ 已启动 ${name}（旧版计划任务，建议重新 server install 迁移）`);
				return;
			}
			if (!installed) fail(`${name} 不存在，请先运行 pi-web-ui server install`);
			const pid = winReadPid(name);
			if (pid && pidAlive(pid)) {
				console.log(`✅ ${name} 已在运行 (PID ${pid})`);
				return;
			}
			launchWinService(winVbsPath(name));
			console.log(`✅ 已启动 ${name}`);
			return;
		}

		if (action === "restart") {
			if (legacy) {
				run("schtasks", ["/End", "/TN", name], {
					ignoreError: true,
					silent: true,
				});
				run("schtasks", ["/Run", "/TN", name]);
				console.log(`✅ 已重启 ${name}（旧版计划任务，建议重新 server install 迁移）`);
				return;
			}
			if (!installed) fail(`${name} 不存在，请先运行 pi-web-ui server install`);
			stopWinInstance(name);
			launchWinService(winVbsPath(name));
			console.log(`✅ 已重启 ${name}`);
			return;
		}

		if (action === "stop") {
			if (legacy) {
				run("schtasks", ["/End", "/TN", name], {
					ignoreError: true,
					silent: true,
				});
				stopWinInstance(name);
				console.log(`⏹  已停止 ${name}（旧版计划任务；重新 server install 可迁移到登录自启）`);
				return;
			}
			stopWinInstance(name);
			console.log(`⏹  已停止 ${name}（自启保留；uninstall 移除）`);
			return;
		}

		fail(`未知操作: ${action}`);
	}

	fail(`不支持的系统服务平台: ${process.platform}（仅 macOS / Linux / Windows）`);
}

async function serverCmd(argv) {
	const { opts, positionals } = parseFlags(argv);
	if (opts.help) {
		console.log(HELP);
		return;
	}
	if (positionals.length === 0) {
		console.log(HELP);
		console.log("--- 当前服务状态 ---");
		controlService("status", opts);
		return;
	}
	const action = positionals[0];
	if (positionals.length > 1) fail(`多余的参数: ${positionals.slice(1).join(" ")}`);
	switch (action) {
		case "shortcut": {
			if (isWin) {
				installWinShortcut(opts);
			} else if (isMac) {
				installMacShortcut(opts);
			} else if (isLinux) {
				installLinuxShortcut(opts);
			} else {
				fail(`不支持的系统服务平台: ${process.platform}`);
			}
			break;
		}
		case "install": {
			if (isMac) {
				installLaunchd(opts);
			} else if (isLinux) {
				installSystemd(opts);
			} else if (isWin) {
				installWindows(opts);
			} else {
				fail(`不支持的系统服务平台: ${process.platform}`);
			}
			break;
		}
		case "uninstall": {
			if (isMac) {
				uninstallLaunchd(opts);
			} else if (isLinux) {
				uninstallSystemd(opts);
			} else if (isWin) {
				uninstallWindows(opts);
			} else {
				fail(`不支持的系统服务平台: ${process.platform}`);
			}
			break;
		}
		case "start":
		case "stop":
		case "restart":
			controlService(action, opts);
			break;
		case "status":
			controlService("status", opts);
			await printLiveStatus(opts);
			break;
		case "quiesce":
			await setQuiesce(opts, true);
			break;
		case "unquiesce":
			await setQuiesce(opts, false);
			break;
		default:
			fail(
				`未知操作: ${action}（install / shortcut / uninstall / start / stop / restart / status / quiesce / unquiesce）`,
			);
	}
}

async function main() {
	checkNodeVersion();
	const argv = process.argv.slice(2);
	if (argv.length === 0) {
		await startForeground({});
		return;
	}
	const first = argv[0];
	if (first === "--version" || first === "-v") {
		console.log(pkg.version);
		return;
	}
	if (first === "--help" || first === "-h") {
		console.log(HELP);
		return;
	}
	if (first === "server") {
		await serverCmd(argv.slice(1));
		return;
	}
	// One-shot server with optional --port/--cwd/--data-dir overrides.
	const { opts, positionals } = parseFlags(argv);
	if (opts.help) {
		console.log(HELP);
		return;
	}
	if (positionals.length > 0) fail(`未知命令: ${positionals[0]}（--help 查看用法）`);
	await startForeground(opts);
}

main().catch((err) => {
	console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
