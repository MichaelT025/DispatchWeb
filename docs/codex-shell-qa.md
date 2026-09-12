# Codex-style shell verification

Verified September 12, 2026 against the isolated production frontend build.

## Implementation

- `web/src/App.tsx`: main-column header, saved conversation title with project fallback, sidebar search action.
- `web/src/components/LeftPanel.tsx`: compact navigation actions, project heading, full-height connection footer.
- `web/src/styles.css`: root-level neutral palette compatible with theme overrides, centered 780px conversation/composer, right-aligned user bubbles, monochrome agent/send controls, neutral inline Markdown preview.
- `DESIGN.md`: recovered shell contract.
- `tests/codex-shell-test.mjs`: isolated real-server/browser regression with synthetic saved messages and a test-only agent status bridge.

## Reproduce

From the repository root:

```powershell
npm run typecheck
npm test
npm run build:web -- --outDir ../tests/scratch/codex-dist
npm run build:server -- --outDir tests/scratch/codex-server
node tests/codex-shell-test.mjs
```

The test uses temporary workspace, agent, session and data directories and randomized ports above 46000. Its Windows cleanup targets only its own server process tree. Production `web/dist`, running user servers, server/protocol source and plugin vendor bundles are not modified.

## Results

| Check | Result |
| --- | --- |
| TypeScript, server/web/tests/desktop | Pass |
| Vitest | 74 files, 693 tests pass |
| Isolated frontend and server compilation | Pass; existing frontend chunk-size warning remains |
| Browser regression | Pass |
| App / LeftPanel language-server diagnostics | None |
| Git whitespace check | Pass |
| Lint | No errors; existing warnings remain; newly unused FiPlus removed |

Commit preparation re-ran `npm run typecheck` and `npm run lint`: typecheck
passed and lint reported eight existing warnings with no errors.
`npm run format:check` reported formatting issues in 332 files, including the
four intended source/test files. Targeted Prettier formatting was applied only
to `App.tsx`, `LeftPanel.tsx`, `styles.css` and `codex-shell-test.mjs`; all four
then passed the targeted formatting check. The other 328 files were left alone.
The isolated builds, unit tests and browser QA above were not repeated during
commit preparation.

Browser assertions cover full-height sidebar, main-only header, saved title, sidebar search, right-aligned bubbles, four confirmed role selection states without composer glow, inline file preview without gradient, terminal keyboard input and tab preservation, file attachment/removal, templates/settings access, light-theme inheritance, and 1280/768/375px reflow with settled mobile drawers. No model requests were used. The role bridge tests presentation and command transport, not actual model/tool switching.

Screenshots wait for finite animations to settle. An earlier mid-transition drawer capture was rejected and replaced. The header-title assertion failed before the saved-session fallback fix and passed afterward.

## Evidence

All paths below are under `tests/scratch/codex-qa/`:

- `01-empty-desktop.png`
- `02-conversation-desktop.png`
- `03-files-desktop.png`
- `04-terminal-desktop.png`
- `05-light-desktop.png`
- `06-responsive-1280.png`, `06-responsive-768.png`, `06-responsive-375.png`
- `07-drawer-768.png`, `07-drawer-375.png`
- `agent-orchestrator.png`, `agent-general.png`, `agent-fast.png`, `agent-review.png`
- `08-attachment.png`, `09-templates.png`, `10-settings.png`
- `result.json`, `server.log`

## Intentional differences and remaining verification

PiAstra retains its real actions, existing settings/templates, four-role picker and responsive drawer rather than copying Codex's native menu bar, account profile or unavailable navigation. The provider-free fixture displays `unknown` for its model. This is a style adaptation, not a pixel-identical clone of different product content.

Independent visual reviewers and Lighthouse/react-render performance audits have not run. The available delegation interface cannot pin a non-opencode-go reviewer model, so no workers were launched. Consequently this report does not claim the independent visual completion gate or Lighthouse 100 certification. Git/plugin workflows, resizing and live streaming send/stop/queue were retained in source but were not end-to-end exercised by this regression.
