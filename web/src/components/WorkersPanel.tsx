import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FiArrowLeft, FiSquare, FiUsers } from "react-icons/fi";
import type { ClientMessage, ToolStatus, UiMessage, UiWorker, UiWorkerTranscript } from "../types";
import { useT } from "../i18n";
import {
	formatElapsed,
	isWorkerActive,
	splitWorkers,
	taskPreview,
	workerElapsedSec,
	workerStatusLabel,
	workerStatusTone,
} from "../workers";
import { Message } from "./Message";
import { RoleChip } from "./RoleChip";

/**
 * Right-workspace Workers pane (Codex-style): read-only Active / Done lists of
 * the ACTIVE conversation's delegated workers, and one worker's transcript
 * rendered with the chat's own message components. Following a worker is a
 * server subscription (open_worker → worker_transcript pushes → close_worker).
 */
interface WorkersPanelProps {
	workers: UiWorker[];
	transcripts: ReadonlyMap<number, UiWorkerTranscript>;
	/** Active conversation id — a switch re-subscribes the selected worker. */
	conversationId: string | undefined;
	/** Selected worker (controlled: the delegate card can open one directly). */
	selected: number | null;
	onSelect: (id: number | null) => void;
	send: (msg: ClientMessage) => boolean;
	thinkingWrap?: boolean;
	toolsWrap?: boolean;
}

const EMPTY_LIVE: ReadonlyMap<string, { toolName: string; text: string }> = new Map();
const EMPTY_STATUS: ReadonlyMap<string, ToolStatus> = new Map();

/** Re-render once a second while any worker runs (elapsed counters). */
function useTick(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [active]);
	return active ? now : Date.now();
}

export const WorkersPanel = memo(function WorkersPanel({
	workers,
	transcripts,
	conversationId,
	selected,
	onSelect,
	send,
	thinkingWrap,
	toolsWrap,
}: WorkersPanelProps) {
	const t = useT();
	const { active, done } = useMemo(() => splitWorkers(workers), [workers]);
	const now = useTick(active.length > 0);
	const current = selected === null ? undefined : workers.find((w) => w.id === selected);

	// Follow the selected worker for as long as it is shown (and re-follow
	// after a conversation switch, which drops the client's transcripts).
	useEffect(() => {
		if (selected === null || !conversationId) return;
		send({ type: "open_worker", workerId: selected });
		return () => {
			send({ type: "close_worker", workerId: selected });
		};
	}, [selected, conversationId, send]);

	// The selected worker vanished (session restore / switch): back to the list.
	useEffect(() => {
		if (selected !== null && workers.length > 0 && !workers.some((w) => w.id === selected)) onSelect(null);
	}, [selected, workers, onSelect]);

	if (current) {
		return (
			<WorkerDetail
				worker={current}
				transcript={transcripts.get(current.id)}
				now={now}
				onBack={() => onSelect(null)}
				onCancel={() => send({ type: "cancel_worker", workerId: current.id })}
				thinkingWrap={thinkingWrap}
				toolsWrap={toolsWrap}
			/>
		);
	}

	if (workers.length === 0) {
		return (
			<div className="workers-empty">
				<FiUsers aria-hidden="true" />
				<div className="workers-empty-title">{t("workersEmptyTitle")}</div>
				<div className="workers-empty-sub">{t("workersEmptyHint")}</div>
			</div>
		);
	}

	return (
		<div className="workers-list" role="list" aria-label={t("astraWorkers")}>
			<WorkerSection title={t("workersActive")} count={active.length} workers={active} now={now} onSelect={onSelect} />
			<WorkerSection title={t("workersDone")} count={done.length} workers={done} now={now} onSelect={onSelect} />
		</div>
	);
});

function WorkerSection({
	title,
	count,
	workers,
	now,
	onSelect,
}: {
	title: string;
	count: number;
	workers: UiWorker[];
	now: number;
	onSelect: (id: number) => void;
}) {
	const t = useT();
	return (
		<section className="workers-section">
			<div className="workers-section-head">
				<span>{title}</span>
				<span className="workers-section-count">{count}</span>
			</div>
			{workers.length === 0 && <div className="workers-section-empty">{t("workersNone")}</div>}
			{workers.map((w) => (
				<WorkerRow key={w.id} worker={w} now={now} onClick={() => onSelect(w.id)} />
			))}
		</section>
	);
}

/** Role chip + status + elapsed + task; the activity line under it. */
function WorkerRow({ worker, now, onClick }: { worker: UiWorker; now: number; onClick: () => void }) {
	const running = isWorkerActive(worker.status);
	return (
		<button
			type="button"
			className={`worker-row tone-${workerStatusTone(worker.status)}`}
			data-role={worker.role}
			role="listitem"
			onClick={onClick}
		>
			<div className="worker-row-head">
				<RoleChip role={worker.role} />
				<span className="worker-id">#{worker.id}</span>
				<span className={`worker-status${running ? " shimmer" : ""}`}>{workerStatusLabel(worker.status)}</span>
				<span className="worker-elapsed">{formatElapsed(workerElapsedSec(worker, now))}</span>
			</div>
			<div className="worker-task" title={worker.task}>
				{taskPreview(worker.task)}
			</div>
			{worker.activity && <div className="worker-activity">{worker.activity}</div>}
		</button>
	);
}

function WorkerDetail({
	worker,
	transcript,
	now,
	onBack,
	onCancel,
	thinkingWrap,
	toolsWrap,
}: {
	worker: UiWorker;
	transcript: UiWorkerTranscript | undefined;
	now: number;
	onBack: () => void;
	onCancel: () => void;
	thinkingWrap?: boolean;
	toolsWrap?: boolean;
}) {
	const t = useT();
	const running = isWorkerActive(worker.status);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);
	const messages = transcript?.messages ?? [];
	const streaming = transcript?.streamingMessage ?? null;
	const all = streaming ? [...messages, streaming] : messages;
	const toolResults = useMemo(() => {
		const m = new Map<string, UiMessage>();
		for (const msg of messages) if (msg.role === "toolResult" && msg.toolCallId) m.set(msg.toolCallId, msg);
		return m;
	}, [messages]);
	const lastId = all.length > 0 ? all[all.length - 1].id : null;

	// Follow live output unless the user scrolled up (same rule as the chat).
	useEffect(() => {
		const el = scrollRef.current;
		if (el && stickRef.current) el.scrollTop = el.scrollHeight;
	}, [transcript]);
	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	};

	return (
		<div className="worker-detail">
			<div className="worker-detail-head">
				<button
					type="button"
					className="worker-back"
					title={t("workersBack")}
					aria-label={t("workersBack")}
					onClick={onBack}
				>
					<FiArrowLeft />
				</button>
				<RoleChip role={worker.role} />
				<span className="worker-id">#{worker.id}</span>
				<span className={`worker-status tone-${workerStatusTone(worker.status)}${running ? " shimmer" : ""}`}>
					{workerStatusLabel(worker.status)}
				</span>
				<span className="worker-elapsed">{formatElapsed(workerElapsedSec(worker, now))}</span>
				<span className="worker-model" title={worker.model}>
					{worker.model}
				</span>
				<span className="worker-spacer" />
				{running && (
					<button type="button" className="worker-cancel" title={t("workersStopTip")} onClick={onCancel}>
						<FiSquare />
						<span>{t("workersStop")}</span>
					</button>
				)}
			</div>
			{/* The transcript's first user message IS the task; repeat it only
			    while there is no transcript to read it from. */}
			{all.length === 0 && (
				<div className="worker-detail-task">
					<div className="worker-detail-label">{t("workersTask")}</div>
					<div className="worker-detail-task-text">{worker.task}</div>
				</div>
			)}
			<div className="worker-transcript" ref={scrollRef} onScroll={onScroll}>
				{transcript === undefined && <div className="worker-transcript-note">{t("workersLoading")}</div>}
				{transcript !== undefined && all.length === 0 && (
					<div className="worker-transcript-note">
						{transcript.source === "none" ? t("workersNoTranscript") : t("workersWaiting")}
					</div>
				)}
				{all.map((m) => (
					<Message
						key={m.id}
						message={m}
						toolResults={toolResults}
						liveOutputs={EMPTY_LIVE}
						toolStatuses={EMPTY_STATUS}
						streaming={running}
						isLast={m.id === lastId}
						toolsWrap={toolsWrap}
						thinkingWrap={thinkingWrap}
					/>
				))}
			</div>
			<div className={`worker-detail-foot tone-${workerStatusTone(worker.status)}`} role="status">
				{worker.activity || workerStatusLabel(worker.status)}
			</div>
		</div>
	);
}
