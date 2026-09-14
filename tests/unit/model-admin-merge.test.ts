import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ModelAdminService, mergeProviderConfigEntry, type ModelAdminHost } from "../../server/model-admin.js";
import type { ServerMessage, UiModelConfigEntry, UiProviderConfig } from "../../server/protocol.js";

/** 表单带上的模型行（UI 只认识这几个字段）。 */
function formModel(id: string, overrides: Partial<UiModelConfigEntry> = {}): UiModelConfigEntry {
	return { id, ...overrides };
}

function formConfig(models: UiModelConfigEntry[], overrides: Partial<UiProviderConfig> = {}): UiProviderConfig {
	return { providerId: "opencode-go", api: "openai-completions", models, ...overrides };
}

/** 覆盖内置 provider 的 models.json 条目：模型级 api/baseUrl/cost/compat 都是 UI 不认识的字段。 */
const storedOverrideEntry = {
	api: "openai-completions",
	baseUrl: "https://opencode.ai/zen/go/v1",
	headers: { "X-Test": "1" },
	models: [
		{
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash",
			api: "openai-completions",
			baseUrl: "https://opencode.ai/zen/go/v1",
			cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
			compat: { thinkingFormat: "deepseek" },
			thinkingLevelMap: { low: "low", high: "high" },
			contextWindow: 1000000,
			maxTokens: 384000,
		},
	],
};

describe("mergeProviderConfigEntry", () => {
	it("没有旧条目时，产出与旧实现一致的条目形状", () => {
		const rows = [
			formModel("m1", { name: "M1", reasoning: true, input: ["text"], contextWindow: 1000, maxTokens: 100 }),
		];
		const merged = mergeProviderConfigEntry(undefined, formConfig(rows, { baseUrl: "https://example.test/v1" }), rows);
		expect(merged).toEqual({
			api: "openai-completions",
			baseUrl: "https://example.test/v1",
			models: [{ id: "m1", name: "M1", reasoning: true, input: ["text"], contextWindow: 1000, maxTokens: 100 }],
		});
	});

	it("provider 级未知字段原样保留（headers 及任意自定义键）", () => {
		const prev = {
			apiKey: "stored",
			headers: { Authorization: "Bearer secret" },
			extraField: { nested: true },
			models: [{ id: "m1" }],
		};
		const merged = mergeProviderConfigEntry(prev, formConfig([formModel("m1")]), [formModel("m1")]);
		expect(merged.headers).toEqual({ Authorization: "Bearer secret" });
		expect(merged.extraField).toEqual({ nested: true });
		// apiKey 是表单字段（listModelsConfig 会下发、表单回填）：表单没带即按清空处理，
		// 与旧实现一致；显式清除密钥走 clear_provider_api_key。
		expect("apiKey" in merged).toBe(false);
	});

	it("模型级未知字段原样保留（覆盖内置 provider 的场景）", () => {
		const rows = [
			formModel("deepseek-flash", {
				name: "DeepSeek V4.1 Flash",
				reasoning: true,
				contextWindow: 1000000,
				maxTokens: 384000,
			}),
		];
		const merged = mergeProviderConfigEntry(storedOverrideEntry, formConfig(rows), rows);
		expect(merged.models).toEqual([{ ...storedOverrideEntry.models[0], reasoning: true }]);
	});

	it("表单字段覆盖旧值（含数字字段归一）", () => {
		const prev = {
			name: "旧名字",
			baseUrl: "https://old.test/v1",
			models: [{ id: "m1", name: "旧模型名", contextWindow: 1000, maxTokens: 10, cost: { input: 1 } }],
		};
		const rows = [formModel("m1", { name: "新模型名", contextWindow: 2000, maxTokens: 20 })];
		const merged = mergeProviderConfigEntry(
			prev,
			formConfig(rows, { name: "新名字", baseUrl: "https://new.test/v1" }),
			rows,
		);
		expect(merged.name).toBe("新名字");
		expect(merged.baseUrl).toBe("https://new.test/v1");
		expect(merged.models).toEqual([
			{ id: "m1", name: "新模型名", contextWindow: 2000, maxTokens: 20, cost: { input: 1 } },
		]);
	});

	it("表单清空的可选字段被删除，不残留旧值", () => {
		const prev = {
			models: [
				{
					id: "m1",
					name: "旧模型名",
					reasoning: true,
					input: ["text", "image"],
					contextWindow: 1000,
					maxTokens: 100,
					compat: { thinkingFormat: "deepseek" },
				},
			],
		};
		const merged = mergeProviderConfigEntry(prev, formConfig([formModel("m1")]), [formModel("m1")]);
		expect(merged.models).toEqual([{ id: "m1", compat: { thinkingFormat: "deepseek" } }]);
	});

	it("models 是「表单即全集」：删掉的 id 移除，新 id 追加", () => {
		const prev = {
			models: [
				{ id: "keep", cost: { input: 1 } },
				{ id: "drop", cost: { input: 2 } },
			],
		};
		const rows = [formModel("keep"), formModel("added", { reasoning: true })];
		const merged = mergeProviderConfigEntry(prev, formConfig(rows), rows);
		expect(merged.models).toEqual([
			{ id: "keep", cost: { input: 1 } },
			{ id: "added", reasoning: true },
		]);
	});

	it("容忍旧条目里的脏数据（非对象 / 缺 id / 空白 id）", () => {
		const prev = { models: [null, "oops", { name: "无 id" }, { id: "   " }, { id: "ok" }] };
		const rows = [formModel("ok", { name: "OK" })];
		const merged = mergeProviderConfigEntry(prev, formConfig(rows), rows);
		expect(merged.models).toEqual([{ id: "ok", name: "OK" }]);
	});
});

describe("ModelAdminService.saveModelConfig", () => {
	it("保存后 models.json 里 UI 不认识的字段仍在（旧实现会静默丢弃）", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-web-ui-model-admin-"));
		const configPath = join(agentDir, "models.json");
		writeFileSync(configPath, JSON.stringify({ providers: { "opencode-go": storedOverrideEntry } }, null, 2) + "\n");

		const notices: ServerMessage[] = [];
		const host = {
			agentDir,
			emit: (msg: ServerMessage) => {
				notices.push(msg);
			},
			flushSnapshot: () => {},
			isDisposed: () => false,
			modelRuntime: () => ({ refresh: async () => {}, setRuntimeApiKey: async () => {} }) as unknown as ModelRuntime,
			invalidatePiConfig: () => {},
			pushModels: async () => {},
		} satisfies ModelAdminHost;

		try {
			const service = new ModelAdminService(host);
			const rows = [
				formModel("deepseek-flash", {
					name: "DeepSeek V4.1 Flash",
					reasoning: true,
					contextWindow: 1000000,
					maxTokens: 384000,
				}),
			];
			await service.saveModelConfig("opencode-go", formConfig(rows));

			const written = JSON.parse(readFileSync(configPath, "utf8")) as {
				providers: Record<string, Record<string, unknown>>;
			};
			const entry = written.providers["opencode-go"];
			// provider 级 headers（浏览器拿不到）与模型级 api/baseUrl/cost/compat 必须存活。
			expect(entry.headers).toEqual({ "X-Test": "1" });
			expect(entry.models).toEqual([{ ...storedOverrideEntry.models[0], reasoning: true }]);
			expect(notices.some((msg) => msg.type === "notice")).toBe(true);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("save→list keeps per-model routing metadata so the UI precedence warning survives reopen", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-web-ui-model-admin-list-"));
		const emissions: ServerMessage[] = [];
		const host = {
			agentDir,
			emit: (msg: ServerMessage) => {
				emissions.push(msg);
			},
			flushSnapshot: () => {},
			isDisposed: () => false,
			modelRuntime: () => ({ refresh: async () => {}, setRuntimeApiKey: async () => {} }) as unknown as ModelRuntime,
			invalidatePiConfig: () => {},
			pushModels: async () => {},
		} satisfies ModelAdminHost;

		try {
			const service = new ModelAdminService(host);
			const rows = [
				formModel("minimax-m3", {
					api: "anthropic-messages",
					baseUrl: "https://opencode.ai/zen/go",
					compat: { thinkingFormat: "deepseek" },
					cost: { input: 1, output: 4 },
					thinkingLevelMap: { low: "low" },
				}),
			];
			await service.saveModelConfig("opencode-go-2", formConfig(rows, { providerId: "opencode-go-2" }));

			// saveModelConfig runs listModelsConfig internally; grab that emission.
			const push = emissions.filter((m) => m.type === "models_config").at(-1);
			if (!push || push.type !== "models_config") throw new Error("no models_config push");
			const entry = push.providers.find((p) => p.providerId === "opencode-go-2");
			// The warning-decision data (per-model baseUrl etc.) must reach the UI.
			expect(entry?.models).toEqual([
				{
					id: "minimax-m3",
					api: "anthropic-messages",
					baseUrl: "https://opencode.ai/zen/go",
					compat: { thinkingFormat: "deepseek" },
					cost: { input: 1, output: 4 },
					thinkingLevelMap: { low: "low" },
				},
			]);

			// A fresh list (reopen) reads from disk and must still carry it.
			emissions.length = 0;
			await service.listModelsConfig();
			const reopened = emissions.find((m) => m.type === "models_config");
			if (!reopened || reopened.type !== "models_config") throw new Error("no reopen push");
			const reopenedEntry = reopened.providers.find((p) => p.providerId === "opencode-go-2");
			expect(reopenedEntry?.models?.[0]?.baseUrl).toBe("https://opencode.ai/zen/go");
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// clone_provider: multi-api / per-model routing metadata must survive.
// ---------------------------------------------------------------------------

/** Minimal runtime stub exposing getProvider/getModels/getRegisteredProviderIds. */
function fakeRuntime(provider: unknown, models: unknown[]): ModelRuntime {
	return {
		getProvider: () => provider,
		getModels: () => models,
		getRegisteredProviderIds: () => [],
		refresh: async () => ({}),
	} as unknown as ModelRuntime;
}

function cloneHost(runtime: ModelRuntime): { host: ModelAdminHost; emissions: ServerMessage[]; cleanup: () => void } {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-web-ui-clone-"));
	const emissions: ServerMessage[] = [];
	const host = {
		agentDir,
		emit: (msg: ServerMessage) => {
			emissions.push(msg);
		},
		flushSnapshot: () => {},
		isDisposed: () => false,
		modelRuntime: () => runtime,
		invalidatePiConfig: () => {},
		pushModels: async () => {},
	} satisfies ModelAdminHost;
	return { host, emissions, cleanup: () => rmSync(agentDir, { recursive: true, force: true }) };
}

/** Real opencode-go shape: openai-* models sit on /zen/go/v1, anthropic-messages
 *  on /zen/go. A single provider-level baseUrl/api cannot represent both. */
const openCodeGoRuntime = () =>
	fakeRuntime({ id: "opencode-go", name: "OpenCode Zen Go", baseUrl: "https://opencode.ai/zen/go/v1" }, [
		{
			id: "qwen3.7-max",
			name: "Qwen3.7 Max",
			api: "openai-completions",
			baseUrl: "https://opencode.ai/zen/go/v1",
			reasoning: false,
			input: ["text"],
			contextWindow: 256000,
			maxTokens: 32768,
			cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0 },
			compat: { maxTokensField: "max_tokens" },
			thinkingLevelMap: { low: "low" },
		},
		{
			id: "minimax-m3",
			name: "MiniMax M3",
			api: "anthropic-messages",
			baseUrl: "https://opencode.ai/zen/go",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 64000,
			cost: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 0 },
		},
	]);

describe("ModelAdminService.cloneProvider", () => {
	it("returns ONE deduplicated config with the full catalog, majority api and a real baseUrl", async () => {
		const { host, emissions, cleanup } = cloneHost(openCodeGoRuntime());
		try {
			const service = new ModelAdminService(host);
			await service.cloneProvider("opencode-go", 7);

			const result = emissions.find((m) => m.type === "clone_provider_result");
			expect(result && result.type === "clone_provider_result" && result.ok).toBe(true);
			if (!result || result.type !== "clone_provider_result") throw new Error("no result");
			const configs = result.configs ?? [];
			expect(configs).toHaveLength(1);
			expect(configs[0]).toBe(result.config);
			const config = configs[0];
			// Majority api (1 openai + 1 anthropic ties → deterministic baseline).
			expect(config.api).toBe("openai-completions");
			// p.baseUrl wins; no fabricated localhost.
			expect(config.baseUrl).toBe("https://opencode.ai/zen/go/v1");
			// One provider id (no -3 sibling) and the whole deduplicated catalog.
			expect(config.providerId).toBe("opencode-go-2");
			expect(config.models.map((m) => m.id)).toEqual(["minimax-m3", "qwen3.7-max"]);
		} finally {
			cleanup();
		}
	});

	it("keeps per-model api/baseUrl/compat/cost/thinkingLevelMap (no lossy rebuild)", async () => {
		const { host, emissions, cleanup } = cloneHost(openCodeGoRuntime());
		try {
			const service = new ModelAdminService(host);
			await service.cloneProvider("opencode-go", 8);

			const result = emissions.find((m) => m.type === "clone_provider_result");
			if (!result || result.type !== "clone_provider_result") throw new Error("no result");
			const all = (result.configs ?? []).flatMap((c) => c.models);
			const qwen = all.find((m) => m.id === "qwen3.7-max");
			expect(qwen?.api).toBe("openai-completions");
			expect(qwen?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
			expect(qwen?.compat).toEqual({ maxTokensField: "max_tokens" });
			expect(qwen?.cost).toEqual({ input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0 });
			expect(qwen?.thinkingLevelMap).toEqual({ low: "low" });
			const minimax = all.find((m) => m.id === "minimax-m3");
			expect(minimax?.api).toBe("anthropic-messages");
			expect(minimax?.baseUrl).toBe("https://opencode.ai/zen/go");
		} finally {
			cleanup();
		}
	});

	it("never fabricates a localhost baseUrl — provider without baseUrl stays template-only", async () => {
		const runtime = fakeRuntime({ id: "opencode", name: "OpenCode", baseUrl: undefined }, [
			{ id: "m1", name: "M1", api: "openai-completions", baseUrl: undefined, input: ["text"] },
		]);
		const { host, emissions, cleanup } = cloneHost(runtime);
		try {
			const service = new ModelAdminService(host);
			await service.cloneProvider("opencode", 9);

			const result = emissions.find((m) => m.type === "clone_provider_result");
			if (!result || result.type !== "clone_provider_result") throw new Error("no result");
			for (const c of result.configs ?? []) {
				expect(c.baseUrl).toBeUndefined();
				expect(c.baseUrl ?? "").not.toContain("127.0.0.1");
			}
		} finally {
			cleanup();
		}
	});

	it("new clone metadata persists on save with no stored entry", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-web-ui-clone-save-"));
		try {
			const { host } = cloneHost(fakeRuntime({ id: "opencode-go", name: "Go", baseUrl: "https://x.test" }, []));
			(host as { agentDir: string }).agentDir = agentDir;
			const service = new ModelAdminService(host);
			// Fresh id → no prior models.json entry; the per-model metadata the
			// clone form carries must survive mergeProviderConfigEntry.
			const rows = [
				formModel("minimax-m3", {
					api: "anthropic-messages",
					baseUrl: "https://opencode.ai/zen/go",
					compat: { thinkingFormat: "deepseek" },
					cost: { input: 1, output: 4 },
					thinkingLevelMap: { low: "low" },
				}),
			];
			await service.saveModelConfig("opencode-go-2", formConfig(rows, { providerId: "opencode-go-2" }));

			const written = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as {
				providers: Record<string, Record<string, unknown>>;
			};
			const entry = written.providers["opencode-go-2"];
			expect(entry).toBeDefined();
			expect(entry.models).toEqual([
				{
					id: "minimax-m3",
					api: "anthropic-messages",
					baseUrl: "https://opencode.ai/zen/go",
					compat: { thinkingFormat: "deepseek" },
					cost: { input: 1, output: 4 },
					thinkingLevelMap: { low: "low" },
				},
			]);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
