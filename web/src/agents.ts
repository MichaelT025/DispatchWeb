/**
 * PiAstra agent roles — client-side constants and parsing helpers.
 *
 * The AUTHORITATIVE active role comes from the PiAstra extension's status
 * bridge: its `select()` ends with `ctx.ui.setStatus("piastra-agent",
 * "Agent: <role>")`, which the server bridges to the browser as a `statuses`
 * message (see server/webui-context.ts). We parse that status here and NEVER
 * infer the role from the active model id — a role switch also changes model /
 * thinking / tools, but model id alone is not a role signal.
 *
 * Extension presence is detected from the slash-command catalog the server
 * pushes: the extension registers `/agent` and `/piastra`. Absent → the UI
 * shows a neutral fallback and must not send a role command (which the SDK
 * would otherwise treat as a plain prompt — model-prompt masquerading).
 */

export const AGENT_ROLES = ["orchestrator", "general", "fast", "review"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Footer-status key the PiAstra extension uses (`setStatus` bridge). */
export const AGENT_STATUS_KEY = "piastra-agent";

/** The extension emits exactly `Agent: <role>` (see extensions/piastra/agents.mjs). */
const AGENT_STATUS_RE = /^Agent:\s*([A-Za-z0-9_-]+)\s*$/i;

export function isAgentRole(value: unknown): value is AgentRole {
	return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

/**
 * Parse the confirmed active role from the server-pushed status entries.
 * Returns null when the status is absent/malformed — callers treat null as
 * "role unknown" and do NOT fall back to the active model.
 */
export function parseAgentRole(
	statuses: { key: string; text: string | undefined }[] | null | undefined,
): AgentRole | null {
	if (!statuses || statuses.length === 0) return null;
	const entry = statuses.find((s) => s.key === AGENT_STATUS_KEY);
	if (!entry?.text) return null;
	const match = AGENT_STATUS_RE.exec(entry.text.trim());
	if (!match) return null;
	const role = match[1].toLowerCase();
	return isAgentRole(role) ? role : null;
}

/**
 * True when the PiAstra extension is loaded: it registers `/agent` (role
 * selection) and `/piastra` (role summary). Checking the catalog is the most
 * reliable "extension present" signal the client has without a protocol change.
 */
export function hasPiastraExtension(slashCommands: { name: string }[] | null | undefined): boolean {
	if (!slashCommands || slashCommands.length === 0) return false;
	return slashCommands.some((c) => c.name === "agent" || c.name === "piastra");
}
