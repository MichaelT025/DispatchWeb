# PiAstra shell design system

## 1. Atmosphere & identity
The supplied `../PiAstra/docs/reference/codex.png` and `codex_empty_sidebar.png`
define the direction: a full-height charcoal project sidebar beside a near-black
working surface, a slim main-only title bar, plain assistant prose and compact
right-aligned user bubbles. Preserve PiAstra's own content and real actions.

## 2. Color
Default palette lives on `:root` in `web/src/styles.css`; downloaded theme links
must override it through the existing cascade. Never put palette overrides on
`.app`, where they would shadow inherited theme values.

| Token | Default | Role |
| --- | --- | --- |
| --bg | #0d0d0e | Main canvas |
| --bg-elev | #17181a | Sidebar |
| --bg-elev2 | #26272a | Hover and selected rows |
| --inputbox-bg | #1b1b1d | Composer |
| --border | #2c2c2e | Composer outline |
| --border-soft | #242528 | Shell dividers |
| --text | #ececec | Primary text |
| --text-dim | #9a9a9e | Secondary text |
| --text-faint | #6d6d72 | Hints |
| --chip-bg | #2a2a2d | User bubble |
| --send-blue | #e8e8e8 | Send fill (legacy token name) |

Agent identity uses labels and pressed state, not hue. Status colors remain
semantic (connection, errors, warnings, diff). Light/custom themes retain their
existing palette mappings. Send uses text/background inversion for contrast.

## 3. Typography
Reuse `--sans` and `--mono`. Brand 15px/700, title 13px/600, navigation
13px/400, section/footer 11px, composer 14.5px, empty wordmark 20px.
Long project and title labels ellipsize; chat prose wraps naturally.

## 4. Spacing & layout
Full-height flex sidebar shell. `.lp-nav` owns sidebar scrolling; brand,
actions and footer remain fixed. `.messages` owns conversation scrolling.
Workspace and terminal keep their existing independent scroll regions.
Main header is 44px; chat content limit is 780px using shared `--chat-inset`.
Compact spacing uses 4/8/12/16px steps, with existing 6/10px control density.
User bubbles cap at min(70%, 640px), 18px radius, 8px 14px padding.
Composer radius 18px; navigation radius 8px. Existing resize handles and
stored widths remain authoritative. At <=768px preserve the mobile drawer,
wrap composer controls and allow bubbles up to 90% width.

## 5. Components
- Sidebar action: real button, icon plus localized label, transparent default,
  elevated hover, visible keyboard focus. New chat and search use existing actions.
- Project groups: existing expandable navigation with nested session rows;
  selected row uses neutral raised surface. Rename/delete remain available.
- Header: existing ghost icon controls, title truncation, mobile menu button.
- Composer: existing AgentPicker, model/thinking dropdowns, attachment/template
  actions, send/stop/queue controls. Focus lightens border without a colored glow.
- Message: user bubble right-aligned; assistant/tool content keeps existing
  rendering, selection, edit, copy, retry and lazy-window behavior.
- Workspace/terminal: existing tabs, file preview and terminal lifecycle.

## 6. Motion & interaction
Retain functional drawer transitions and hover/focus feedback. No decorative
animation. Reduced-motion users receive immediate shell transitions.

## 7. Depth & surface
Mixed tonal steps and thin neutral dividers. No composer glow or agent-colored
border. Menus retain existing elevation to distinguish overlays from content.

## 8. Accessibility constraints & accepted debt
Maintain keyboard shortcuts, labeled buttons, pressed states and visible focus.
Do not encode agent role solely by color. Verify desktop, mobile drawer,
long text and bundled light theme using actual browser captures.
The references have different product content and native desktop menu chrome;
those are not copied. Existing component internals remain outside this shell
restyling scope. No new accessibility debt is accepted by this document.
