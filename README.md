# PiAstra web UI

A Codex-style browser shell for the [pi coding agent](https://pi.dev), built
for [PiAstra](../PiAstra). Forked from
[xing-shuyin/pi-web-ui](https://github.com/xing-shuyin/pi-web-ui) and stripped
down to the harness: project sidebar, conversation, files / git review pane,
bottom terminal, and a model + agent-role pill in the composer.

Everything role-related (orchestrator / general / fast / review, the
`delegate` tool, `/agent`) lives in PiAstra's own pi extension. This UI only
renders what that extension reports.

## What's here

| Area | Files |
| --- | --- |
| Server (Express + WebSocket around the pi SDK) | `server/` — `index.ts` host, `agent-service.ts` sessions, `protocol.ts` wire types |
| Web client (React + Vite) | `web/src/` — `App.tsx` shell, `use-chat.ts` socket state, `components/` |
| Design tokens and surface styles | `DESIGN.md`, `web/src/styles.css`, `web/src/css/*.css` |
| CLI / service install | `bin/pi-web-ui.mjs`, `deploy/` |
| Tests | `tests/unit/*.test.ts` (vitest), `tests/*-test.mjs` (protocol smoke, browser E2E) |

Removed relative to upstream: UI plugins and the plugin marketplace, the DSH
engine, goal / review loop and wizard, inline markers / todo, built-in
subagents and `delegate_task`, `edit_soft`, the vision bridge, MCP bridge,
downloadable themes and language packs (the UI is English-only), sound cues,
wallpaper, quick phrases, prompt-template gallery, the Electron desktop app,
the browser extension, and the self-update checker.

## Run

Requirements: Node ≥ 22.19 and a configured pi install.

From PiAstra, `npm run start:fork` runs this checkout's built artifacts with an
isolated agent dir and UI state (see PiAstra's `docs/FORK_PLAN.md`). Build
first:

```bash
npm ci && npm run build
```

Standalone:

```bash
npm start                 # node dist/server/index.js — http://localhost:8787
npm run dev               # vite on :5173 proxying a tsx server on :8788
node bin/pi-web-ui.mjs --help
```

## Checks

```bash
npm run typecheck         # server + web + tests
npm run lint
npm test                  # vitest unit tests
npm run test:smoke        # zero-token protocol smoke tests (each spawns its own server)
```

Browser E2E scripts under `tests/` (`astra-shell-test.mjs`,
`astra-agent-sidebar-test.mjs`, …) drive a real Chromium via `tests/lib/chrome.mjs`
and are run by hand.

## Environment

| Variable | Default | Role |
| --- | --- | --- |
| `PI_WEB_PORT` / `PI_WEB_HOST` | `8787` / `127.0.0.1` | Listen address |
| `PI_WEB_CWD` | process cwd | Initial workspace |
| `PI_WEB_DATA_DIR` | `<cwd>/.pi-web` | UI state, uploads, client-state.json |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi config dir (auth, models, sessions) |
| `PI_WEB_TOKEN` | unset | Shared bearer token for HTTP + WS |
| `PI_WEB_ALLOW_ORIGINS` / `PI_WEB_ALLOW_HOSTS` | loopback | Extra origins / hosts when exposed |
| `PI_WEB_TABS` | all | Restrict the workspace tabs an instance offers (`git`, `terminal`, …) |
| `PI_WEB_MANAGED` | unset | `1` hides restart / install affordances |
| `PI_WEB_SHELL` | PowerShell / login shell | Interactive terminal shell |
| `PI_WEB_TERMINAL_IDLE_MS` / `PI_WEB_TERMINAL_IDLE_LINES` | `15000` / `10` | Idle-terminal steer notice |
| `PI_WEB_TOOL_TIMEOUT_MS` | `1200000` | Tool-call watchdog |
| `PI_WEB_UPLOAD_RETENTION_DAYS` | `14` | Upload cleanup (`0` disables) |

## License

MIT — see `LICENSE`. Upstream copyright belongs to the pi-web-ui authors.
