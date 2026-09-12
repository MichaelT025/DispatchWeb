import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Run real server tests sequentially with isolated defaults and complete logs. */
export async function runSuite(suite, catalog, skips = {}) {
	const selected = process.argv.slice(2);
	const names = selected.length ? selected : catalog;
	if (names.some((name) => !catalog.includes(name)))
		throw new Error(`Unknown ${suite} test: ${names.filter((name) => !catalog.includes(name)).join(", ")}`);
	if (!existsSync(join(root, "dist/server/index.js"))) throw new Error("Build first: npm run build");
	const outputDir = join(root, "test-results", suite);
	mkdirSync(outputDir, { recursive: true });
	const results = [];
	for (const name of names) {
		if (!selected.length && skips[name]) {
			console.log(`SKIP ${name}: ${skips[name]}`);
			results.push({ name, status: "skipped", reason: skips[name] });
			continue;
		}
		const temp = mkdtempSync(join(tmpdir(), "piastra-ci-"));
		const log = createWriteStream(join(outputDir, `${name}.log`));
		console.log(`\nRUN ${name}`);
		const started = Date.now();
		const result = await new Promise((resolve) => {
			const child = spawn(process.execPath, [join(root, "tests", `${name}.mjs`)], {
				cwd: root,
				windowsHide: true,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: join(temp, "agent"),
					PI_WEB_DATA_DIR: join(temp, "data"),
					PI_WEB_SKIP_TEST_BUILD: "1",
					PI_WEB_TEST_ARTIFACTS: outputDir,
				},
			});
			for (const stream of [child.stdout, child.stderr])
				stream.on("data", (chunk) => {
					process.stdout.write(chunk);
					log.write(chunk);
				});
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				console.error(`TIMEOUT ${name} after 180 seconds`);
				try {
					if (process.platform === "win32")
						execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
					else process.kill(-child.pid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			}, 180_000);
			child.once("error", (error) => {
				clearTimeout(timer);
				log.end(String(error));
				resolve({ status: "failed", error: error.message });
			});
			child.once("close", (code) => {
				clearTimeout(timer);
				log.end();
				resolve({ status: code === 0 && !timedOut ? "passed" : "failed", code, timedOut });
			});
		});
		results.push({ name, ...result, durationMs: Date.now() - started });
	}
	writeFileSync(join(outputDir, "summary.json"), JSON.stringify(results, null, 2) + "\n");
	const count = (status) => results.filter((r) => r.status === status).length;
	console.log(`\n${suite}: ${count("passed")} passed, ${count("failed")} failed, ${count("skipped")} skipped`);
	if (count("failed")) process.exitCode = 1;
}
