#!/usr/bin/env node
import { runSuite } from "./lib/run-suite.mjs";
await runSuite("browser", [
	"astra-shell-test",
	"astra-agent-sidebar-test",
	"astra-workers-test",
	"logo-test",
	"subscriptions-browser-test",
]);
