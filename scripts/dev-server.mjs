// Dev backend launcher: derives PI_WEB_PORT / PI_WEB_ALLOW_ORIGINS from the
// same env vars web/vite.config.ts reads, so `DISPATCH_DEV_PORT=5174
// PI_WEB_PORT=8789 npm run dev` runs a second checkout beside the default one.
//
// Restarts via `tsx watch` rather than `node --watch`: on Windows volumes
// with last-access updates enabled, libuv reports a file READ (e.g. git
// re-reading a modified source file during the SCM refresh) as a change,
// which threw node's watcher into a restart loop. chokidar (tsx) ignores
// atime-only events.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const devPort = Number(process.env.DISPATCH_DEV_PORT) || 5173;
const backendPort = Number(process.env.PI_WEB_PORT) || 8788;

const child = spawn(process.execPath, [tsxCli, "watch", "--clear-screen=false", "server/index.ts"], {
	// No stdin: tsx watch stalls behind a never-closing pipe (what concurrently
	// hands its children) and the server never binds.
	stdio: ["ignore", "inherit", "inherit"],
	env: {
		...process.env,
		PI_WEB_PORT: String(backendPort),
		PI_WEB_ALLOW_ORIGINS: `http://localhost:${devPort},http://127.0.0.1:${devPort}`,
	},
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
