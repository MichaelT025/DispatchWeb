/** Worker role label with the role's hue dot (orchestrator / general / fast /
 *  review — see --agent-* in styles.css). The text carries the role; the
 *  colour is a hint, never the only signal. Shared by the delegate tool card
 *  and the Workers pane (its own file keeps ToolCallBlock ⇄ WorkersPanel
 *  from importing each other). */
export function RoleChip({ role }: { role: string }) {
	return (
		<span className="worker-role" data-role={role}>
			<span className="worker-role-dot" aria-hidden="true" />
			{role || "worker"}
		</span>
	);
}
