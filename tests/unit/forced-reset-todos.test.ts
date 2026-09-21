import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { ClientSession } from "../../server/agent-service.js";
import { ConversationTodos } from "../../server/todo-state.js";
import { NotificationLifecycle } from "../../server/notification-lifecycle.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, createAgentSessionRuntime: vi.fn() };
});

import { createAgentSessionRuntime } from "@earendil-works/pi-coding-agent";

const createRuntime = vi.mocked(createAgentSessionRuntime);

type ConversationHarness = {
	id: string;
	notificationLifecycle: NotificationLifecycle;
	runtime: AgentSessionRuntime;
	session: AgentSession;
	cwd: string;
	unsubscribe?: () => void;
	toolStartTimes: Map<string, number>;
	toolWatchdogs: Map<string, ReturnType<typeof setTimeout>>;
};

type ServiceHarnessFields = {
	convs: Map<string, ConversationHarness>;
	activeId: string;
	convTodos: Map<string, ConversationTodos>;
	sinks: Set<(message: unknown) => void>;
};

type ForceReset = (conversation: ConversationHarness, reason: string) => Promise<void>;

const todoResult = (action: string, tasks: unknown[], nextId: number) => ({
	type: "message",
	message: {
		role: "toolResult",
		toolName: "todo",
		details: { action, params: {}, tasks, nextId },
	},
});

const task = { id: 1, subject: "stuck task", status: "in_progress" };

function fakeSession(branch: unknown[], onSubscribe?: () => void): AgentSession {
	return {
		sessionManager: { getBranch: vi.fn(() => branch) },
		bindExtensions: vi.fn(async () => {}),
		subscribe: vi.fn(() => {
			onSubscribe?.();
			return vi.fn();
		}),
	} as unknown as AgentSession;
}

function fakeRuntime(session: AgentSession, dispose: () => void): AgentSessionRuntime {
	return { session, dispose: vi.fn(async () => dispose()) } as unknown as AgentSessionRuntime;
}

describe("forced reset todo handoff", () => {
	beforeEach(() => createRuntime.mockReset());

	it("publishes idle todos before disposal and retains them through replacement/reconnect", async () => {
		const order: string[] = [];
		const published: unknown[] = [];
		const currentBranch = [todoResult("create", [task], 2)];
		// A normal replay of the replacement branch would restore no run ids:
		// the user boundary separates the old mutation from the read-only list.
		const replacementBranch = [
			todoResult("create", [task], 2),
			{ type: "message", message: { role: "user" } },
			todoResult("list", [task], 2),
		];
		const currentSession = fakeSession(currentBranch);
		const replacementSession = fakeSession(replacementBranch);
		const currentRuntime = fakeRuntime(currentSession, () => order.push("dispose"));
		const replacementRuntime = fakeRuntime(replacementSession, () => {});
		createRuntime.mockResolvedValue(replacementRuntime);

		const conv = {
			id: "conversation-1",
			notificationLifecycle: new NotificationLifecycle(),
			runtime: currentRuntime,
			session: currentSession,
			cwd: "C:/forced-reset-test",
			unsubscribe: () => order.push("unsubscribe"),
			toolStartTimes: new Map(),
			toolWatchdogs: new Map(),
		} satisfies ConversationHarness;
		const todos = new ConversationTodos();
		todos.startRun();
		todos.apply({ action: "create", params: {}, tasks: [task], nextId: 2 });

		const service = Object.create(ClientSession.prototype) as ClientSession;
		const harness = service as unknown as ServiceHarnessFields;
		harness.convs = new Map([[conv.id, conv]]);
		harness.activeId = conv.id;
		harness.convTodos = new Map([[conv.id, todos]]);
		harness.sinks = new Set([
			(message: unknown) => {
				if ((message as { type?: string }).type === "todos") {
					published.push({ ...(message as object) });
					order.push((message as { running?: boolean }).running === false ? "idle-todos" : "todos");
				}
			},
		]);
		Object.assign(service, {
			disposed: false,
			pendingNotices: [],
			convStatuses: { remove: vi.fn(), activeSnapshot: () => [] },
			webUi: { refresh: vi.fn(), snapshot: () => [] },
			workerBuses: new Map(),
			bg: { push: vi.fn() },
			modelAdmin: { listProviderKeys: vi.fn() },
			applyRetryOverrides: vi.fn(),
			scheduleSnapshot: vi.fn(),
			startWidgetsTimer: vi.fn(),
			startStallTimer: vi.fn(),
			emitConversations: vi.fn(),
			pushSlashCommands: vi.fn(async () => {}),
			pushSettings: vi.fn(),
			pushTerminals: vi.fn(),
		});

		const forceReset = (ClientSession.prototype as unknown as { forceResetConversation: ForceReset })
			.forceResetConversation;
		await forceReset.call(service, conv, "hung run");

		const idle = {
			type: "todos",
			tasks: [task],
			nextId: 2,
			runIds: [1],
			running: false,
		};
		const idleIndex = published.findIndex((message) => JSON.stringify(message) === JSON.stringify(idle));
		expect(idleIndex).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("idle-todos")).toBeLessThan(order.indexOf("unsubscribe"));
		expect(order.indexOf("unsubscribe")).toBeLessThan(order.indexOf("dispose"));
		expect(published).toContainEqual(idle);
		expect(replacementSession.sessionManager.getBranch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();

		const reconnect: unknown[] = [];
		(service as unknown as { attachSink: (send: (message: unknown) => void) => void }).attachSink((message) => {
			if ((message as { type?: string }).type === "todos") reconnect.push(message);
		});
		expect(reconnect).toContainEqual(idle);
	});
});
