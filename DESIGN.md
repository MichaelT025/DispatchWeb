# PiAstra shell design system

## 1. Atmosphere & identity

The supplied `../PiAstra/docs/reference/codex.png` and `codex_empty_sidebar.png`
define the direction: a full-height charcoal project sidebar beside a near-black
working surface, a slim main-only title bar, plain assistant prose and compact
right-aligned user bubbles. Preserve PiAstra's own content and real actions.

## 2. Color

Default palette lives on `:root` in `web/src/styles.css` (the "§Astra pass 2"
block near the end is the effective one); downloaded theme links must override
it through the existing cascade. Never put palette overrides on `.app`, where
they would shadow inherited theme values. Surface restyles live in
`web/src/css/{shell,messages,composer,workspace,polish}.css`, loaded after
`styles.css`, and must only use tokens (no literal colors) so themes keep
working. The canvas is a lifted near-black, not `#000`, so hairlines and card
surfaces have room to read as tonal steps.

| Token                          | Default            | Role                                              |
| ------------------------------ | ------------------ | ------------------------------------------------- |
| --bg                           | #0a0a0b            | Main canvas, header, workspace                    |
| --bg-elev                      | #141416            | Sidebar rail, modals                              |
| --bg-elev2                     | #1e1e21            | Hover and selected rows, ghost-button hover       |
| --inputbox-bg                  | #151517            | Composer                                          |
| --card-bg                      | #0f0f11            | Tool/bash cards, fenced code, inline dialogs      |
| --chip-bg                      | #18181b            | User bubble                                       |
| --menu-bg                      | #17171a            | Dropdown menus                                    |
| --border                       | #2b2b30            | Composer focus outline, menu borders              |
| --border-soft                  | #1c1c20            | Shell hairlines, card borders                     |
| --text                         | #ececee            | Primary text                                      |
| --text-dim                     | #9e9ea6            | Secondary text                                    |
| --text-faint                   | #6b6b74            | Hints, section labels                             |
| --accent                       | #b9b9c2            | Focus ring only (neutral)                         |
| --send-blue / --send-fg        | #ffffff / #0a0a0b  | Send + primary button fill and label              |
| --code-inline-bg               | #1b1b1f            | Inline code                                       |
| --radius-sm/md/lg/xl           | 6 / 10 / 14 / 20px | Controls / menus / cards+modals / composer+bubble |
| --shadow-menu / --shadow-modal | —                  | Overlay elevation                                 |
| --ring                         | —                  | Shared `:focus-visible` box-shadow                |

Agent identity uses labels and pressed state, not hue. Status colors remain
semantic (connection, errors, warnings, diff). Light/custom themes retain their
existing palette mappings. Send and `.btn.primary` use text/background
inversion for contrast.

## 3. Typography

`--sans` and `--mono` both resolve to JetBrains Mono (Google Fonts, Cascadia
Code → system mono fallback): the whole shell is set in mono for a terminal-
harness feel. The xterm canvas uses the same stack at 13.5px. The brand mark is `web/src/assets/piastra-mark.svg`, inlined through
`components/Logo.tsx` so it follows `currentColor`.

Scale: body 15px; chat prose and user bubble 14.5px / 1.7; composer 15px;
navigation, card headers and menu rows 14px; mono in cards and fenced code
13–13.5px; inline code 13.5px; section labels 11.5px uppercase tracked; brand
15px/600; header title 14px/500; empty wordmark 24px/600. Mono needs no negative tracking; headings sit at 0. The whole `styles.css` scale sits one point above the
original (11→12 … 16→17); anything new should land on that scale.
Long project and title labels ellipsize; chat prose wraps naturally.

## 4. Spacing & layout

Full-height flex sidebar shell with a hairline between rail and canvas.
`.lp-nav` owns sidebar scrolling; brand, actions and footer remain fixed.
`.messages` owns conversation scrolling. Workspace and terminal keep their
existing independent scroll regions. Main header is 48px with a hairline;
chat content limit is 780px using shared `--chat-inset`. Compact spacing uses
4/8/12/16px steps with 30–32px control rows. Turns sit 28px apart. User
bubbles cap at min(72%, 640px), `--radius-xl` with a `--radius-sm` tail
corner, 10px 16px padding. Composer uses `--radius-xl` and a soft drop
shadow; navigation uses `--radius-sm`. Existing resize handles and stored
widths remain authoritative. At <=768px preserve the mobile drawer, wrap
composer controls and allow bubbles up to 90% width.

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

Tonal steps (canvas → card → rail → raised row) with hairline dividers. The
composer carries a soft shadow and inset top highlight; menus and modals use
`--shadow-menu` / `--shadow-modal`. No agent-colored border. Focus is one
shared neutral ring (`--ring`), never a colored glow.

## 8. Accessibility constraints & accepted debt

Maintain keyboard shortcuts, labeled buttons, pressed states and visible focus.
Do not encode agent role solely by color. Verify desktop, mobile drawer,
long text and bundled light theme using actual browser captures.
The references have different product content and native desktop menu chrome;
those are not copied. Existing component internals remain outside this shell
restyling scope. No new accessibility debt is accepted by this document.
