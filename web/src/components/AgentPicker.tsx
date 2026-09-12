import { memo } from "react";
import { AGENT_ROLES, type AgentRole } from "../agents";
import { useT } from "../i18n";

/** i18n key per role — resolved through `t` so the picker stays localized. */
const ROLE_LABEL_KEY = {
	orchestrator: "agentRoleOrchestrator",
	general: "agentRoleGeneral",
	fast: "agentRoleFast",
	review: "agentRoleReview",
} as const;

interface AgentPickerProps {
	/** Confirmed active role from the server status bridge (null = unknown —
	 *  we render no pressed button rather than an optimistic false label). */
	activeRole: AgentRole | null;
	/** Whether the PiAstra extension is loaded (/agent + /piastra present). */
	available: boolean;
	/** Busy (agent streaming) → buttons disabled with an explanation. */
	busy: boolean;
	onSelect: (role: AgentRole) => void;
}

/**
 * Compact role picker shown near the composer. It is purely a client-side
 * selector over the EXISTING `/agent <role>` slash-command transport: selecting
 * a role sends that command to the server, the extension performs the real
 * switch (model + thinking + tools + `setStatus`), and the highlight follows
 * the confirmed server status — never an optimistic local guess.
 */
export const AgentPicker = memo(function AgentPicker({ activeRole, available, busy, onSelect }: AgentPickerProps) {
	const t = useT();

	// Neutral fallback when the extension is absent: a single muted, non-
	// interactive badge. No role is claimed and no /agent prompt is sent.
	if (!available) {
		return (
			<div className="agent-picker agent-picker-unavailable" role="status" title={t("agentPickerUnavailable")}>
				<span aria-hidden="true">⚙</span>
				<span>{t("agentPickerNeutral")}</span>
			</div>
		);
	}

	const disabled = busy;
	const reason = busy ? t("agentPickerBusy") : undefined;

	return (
		<div className="agent-picker" role="group" aria-label={t("agentPickerLabel")}>
			{AGENT_ROLES.map((role) => {
				const active = activeRole === role;
				return (
					<button
						key={role}
						type="button"
						className={`agent-picker-btn${active ? " active" : ""}`}
						data-agent-role={role}
						aria-pressed={active}
						disabled={disabled}
						title={reason ?? t(ROLE_LABEL_KEY[role])}
						onClick={() => onSelect(role)}
					>
						{t(ROLE_LABEL_KEY[role])}
					</button>
				);
			})}
			{/* Accessible, text-based active label — color/highlight is never the
			    sole signal. Also doubles as the busy explanation (live region). */}
			<span className="agent-picker-active" role="status">
				{busy
					? t("agentPickerBusy")
					: activeRole
						? t("agentActiveRole", { role: t(ROLE_LABEL_KEY[activeRole]) })
						: t("agentUnknown")}
			</span>
		</div>
	);
});
