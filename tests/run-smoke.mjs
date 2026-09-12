#!/usr/bin/env node
import { runSuite } from "./lib/run-suite.mjs";

// Compiled server + local fixtures. No provider credentials required.
const tests = [
	"clear-provider-key-test",
	"conv-cross-project-test",
	"conv-cwd-test",
	"saved-chats-per-project-test",
	"project-model-key-test",
	"provider-keys-test",
	"fetch-models-test",
	"global-search-test",
	"left-panel-delete-test",
	"list-files-missing-dir-test",
	"preview-test",
	"quiesce-test",
	"question-bridge-test",
	"recursive-watch-test",
	"refresh-models-test",
	"restart-handoff-test",
	"restart-service-test",
	"scm-features-test",
	"settings-test",
	"slash-commands-test",
	"snapshot-delta-test",
	"steer-queue-smoke",
	"switch-session-background-test",
	"terminal-smoke-test",
	"token-auth-test",
];

// Linux still runs both. Explicit selection bypasses these known platform skips.
const skips =
	process.platform === "win32"
		? {
				"terminal-smoke-test": "ConPTY exit-event differences; browser suite checks terminal startup/input",
				"restart-handoff-test": "libuv named-pipe shutdown assertion on Windows",
			}
		: {};
await runSuite("protocol", tests, skips);
