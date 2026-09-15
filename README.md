# Dispatch Web

A Codex-style browser shell for the [pi coding agent](https://pi.dev), built
for [Dispatch](../PiAstra). Dispatch Web was formerly named PiAstra web UI. Forked from
[xing-shuyin/pi-web-ui](https://github.com/xing-shuyin/pi-web-ui) and stripped
down to the harness: project sidebar, conversation, files / git review pane,
bottom terminal, and a model + agent-role pill in the composer.

> Compatibility note: only the product name changed. The `pi-web-ui` executable and service files, `PI_WEB_*` environment variables, browser storage keys, the sibling `../PiAstra` path, and the GitHub repository `PiAstra-web-ui` are unchanged intentionally. Role, worker and worktree behavior comes from the Dispatch (`extensions/piastra`) extension in the parent checkout. The provisional package scope `@michaelt025/dispatch-web` is not published (registry path 404s, scope ownership unconfirmed), so there are no install instructions for it.

Everything role-related (orchestrator / general / fast / review, the
`delegate` tool, `/agent`) lives in Dispatch's own pi extension. This UI only
renders what that extension reports.

## Workers

Delegated workers (Dispatch's `delegate` tool) show up in two places:

- **Delegate card** in the chat: one row per worker of that call — role, status,
  elapsed time and the extension's current activity line. A row opens that
  worker in the pane; "Open workers" opens the lists.
- **Workers pane** in the right workspace (Ctrl+Shift+L, or the Workers item
  in the workspace chooser): Codex-style **Active** / **Done** lists for the
  current conversation, and one worker's transcript rendered with the chat's
  own message and tool components. Running workers stream in live and can be
  stopped individually; finished ones come from the extension's in-memory
  session, or from the saved JSONL under `<agent dir>/piastra/runs` after a
  restart. Workers are scoped to the conversation, not the project.

The data comes from the extension's `piastra:workers` event channel
(Dispatch `extensions/piastra/worker-bridge.mjs`, version 1): the server's
inline `pi-webui-workers` extension subscribes on each conversation's runtime,
mirrors the worker list into `UiState.workers`, serves transcripts on
`open_worker`, and relays `cancel_worker`. Nothing polls, and no worker text
is scraped from tool output. Without the extension the tab is simply empty.

## Worktrees

A git repository is one project in the sidebar whatever checkout a chat runs
in. Linked worktrees — the CLI's `/worktree add` layout under
`~/.pi/worktrees/<repo>/<branch-slug>`, Claude Code's `.claude/worktrees/…`,
or anything `git worktree add` made — are folded into the repository's main
checkout (`git worktree list`), so their chats and history show under one
project with a branch marker in front of the title (the branch name is the
tooltip). A repository's history is listed across all of its checkouts.

A chat is bound to one checkout for its whole life: its tools, terminals,
file tree, git panel and Dispatch workers all run there. Choosing happens on
an empty chat only — the composer shows the current branch with a
**Worktree** checkbox. Ticking it asks for a branch name (blank = a generated
`bright-fox` style name) and, on **Create**, checks that branch out as a
managed worktree (existing local branch reused, remote branch tracked, new
branch cut from `origin/<default>` without an upstream) and moves the blank
chat there; unticking it in a worktree chat goes back to a blank chat in the
main checkout. The repository row's hover actions add _New chat in a fresh
worktree_ with a generated name.

Hovering a worktree-backed chat or history row offers _Remove worktree_
(two-step, branch kept). Idle chats open in that worktree are closed first
and the active one moves out; a streaming chat or open terminal refuses. A
checkout with uncommitted changes asks once more before a forced removal.
Removal is refused for the main checkout and locked worktrees.

Wire: `worktree_add { cwd?, branch? }` / `worktree_remove { path, force? }`
answered by `worktree_result`; `ProjectSummary.worktrees` carries every
checkout. `server/worktrees.ts` mirrors the CLI extension's porcelain parser,
branch slug and managed-path rules.

## Responsiveness

Every sidebar click paints before the server answers: a new chat shows the
empty composer at once (the runtime boots behind it — sending is held for
that moment), a switch to a recently viewed chat re-shows its still-mounted
message list, and a history row renders its transcript from the session
file first (`UiState.booting`) while the runtime starts. On the server a
cross-project new chat boots one runtime (it used to resume the project's
last session and then replace it), snapshots go out before the per-project
key/model restores, and `server/patch-extension-cache.ts` rewrites the SDK's
extension loader so compiled extension modules are cached per file instead
of being thrown away on every cwd change — a project switch went from ~3 s
to ~0.2 s with the Dispatch extension set.

## What's here

| Area                                           | Files                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Server (Express + WebSocket around the pi SDK) | `server/` — `index.ts` host, `agent-service.ts` sessions, `protocol.ts` wire types   |
| Web client (React + Vite)                      | `web/src/` — `App.tsx` shell, `use-chat.ts` socket state, `components/`              |
| Design tokens and surface styles               | `DESIGN.md`, `web/src/styles.css`, `web/src/css/*.css`                               |
| CLI / service install                          | `bin/pi-web-ui.mjs`, `deploy/`                                                       |
| Tests                                          | `tests/unit/*.test.ts` (vitest), `tests/*-test.mjs` (protocol smoke, browser E2E)    |
| Delegated workers                              | `server/workers.ts` hub, `web/src/components/WorkersPanel.tsx`, `web/src/workers.ts` |
| Git worktrees                                  | `server/worktrees.ts`, `web/src/components/WorktreePill.tsx`, `left-panel-nav.ts`    |

Removed relative to upstream: UI plugins and the plugin marketplace, the DSH
engine, goal / review loop and wizard, inline markers / todo, built-in
subagents and `delegate_task`, `edit_soft`, the vision bridge, MCP bridge,
downloadable themes and language packs (the UI is English-only), sound cues,
wallpaper, quick phrases, prompt-template gallery, the Electron desktop app,
the browser extension, and the self-update checker.

## Run

Requirements: Node ≥ 22.19 and a configured pi install.

From Dispatch, `npm run start:fork` runs this checkout's built artifacts with an
isolated agent dir and UI state (see Dispatch's `docs/FORK_PLAN.md`). Build
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
npm run format           # apply the repository formatter
npm run check            # formatting, lint, protocol sync, and all TypeScript projects
npm run build
npm test                 # unit tests
npm run test:smoke       # protocol integration tests with local fixtures
npx playwright-core install chromium
npm run test:browser     # production shell, files/Git/terminal, sidebar, role bridge, workers pane
npm run ci               # the full local sequence, including build
```

CI runs on every branch push, PRs into `main`, and manual dispatch. Static
checks run on Linux; unit and protocol tests run on Linux and Windows; browser
tests run on Linux with Chromium. Older runs of the same branch are cancelled.
No provider credentials or sibling Dispatch checkout are required. The role and
workers browser tests use test extensions to verify the status and worker
bridges, not live delegation.

CI builds once per test job. The protocol and browser runners use isolated agent
and UI state defaults, enforce a three-minute timeout per script, and write logs,
screenshots and JSON summaries under ignored `test-results/`. CI uploads these
artifacts even on failure. Run one test with, for example,
`npm run test:smoke -- settings-test` or
`npm run test:browser -- astra-shell-test` (build first).

Windows skips the existing ConPTY exit-event and libuv restart-handoff tests;
skips are reported separately from passes. Linux runs both, and the portable
browser test also checks actual terminal input/output on Windows. Explicitly
selecting a skipped test runs it. `PI_WEB_CHROME` can select an existing browser;
otherwise discovery uses the installed Playwright revision or system Chrome.
Other scripts in `tests/` remain manual diagnostics outside the CI suites.

## Environment

| Variable                                                 | Default                  | Role                                                                  |
| -------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `PI_WEB_PORT` / `PI_WEB_HOST`                            | `8787` / `127.0.0.1`     | Listen address                                                        |
| `PI_WEB_CWD`                                             | process cwd              | Initial workspace                                                     |
| `PI_WEB_DATA_DIR`                                        | `<cwd>/.pi-web`          | UI state, uploads, client-state.json                                  |
| `PI_CODING_AGENT_DIR`                                    | `~/.pi/agent`            | pi config dir (auth, models, sessions)                                |
| `PI_WEB_TOKEN`                                           | unset                    | Shared bearer token for HTTP + WS                                     |
| `PI_WEB_ALLOW_ORIGINS` / `PI_WEB_ALLOW_HOSTS`            | loopback                 | Extra origins / hosts when exposed                                    |
| `PI_WEB_TABS`                                            | all                      | Restrict the workspace tabs an instance offers (`git`, `terminal`, …) |
| `PI_WEB_MANAGED`                                         | unset                    | `1` hides restart / install affordances                               |
| `PI_WEB_SHELL`                                           | PowerShell / login shell | Interactive terminal shell                                            |
| `PI_WEB_TERMINAL_IDLE_MS` / `PI_WEB_TERMINAL_IDLE_LINES` | `15000` / `10`           | Idle-terminal steer notice                                            |
| `PI_WEB_TOOL_TIMEOUT_MS`                                 | `1200000`                | Tool-call watchdog                                                    |
| `PI_WEB_UPLOAD_RETENTION_DAYS`                           | `14`                     | Upload cleanup (`0` disables)                                         |

## License

MIT — see `LICENSE`. Upstream copyright belongs to the pi-web-ui authors.
