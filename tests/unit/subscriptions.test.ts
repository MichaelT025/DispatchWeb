import { afterEach, describe, expect, it, vi } from "vitest";
import {
	setSubscriptionUsageModuleLoaderForTests,
	subscriptionUsage,
	type SubscriptionModelRuntime,
} from "../../server/subscriptions.js";

const definitions = ["openai-codex", "opencode-go", "command-code"].map((id) => ({
	id,
	displayName: id,
	load: async () => ({}),
}));

function fakeModules(
	fetchResult: (provider: { id: string }) => any = (provider: { id: string }) => ({
		providerId: provider.id,
		displayName: provider.id,
		state: "ok",
		windows: [],
		fetchedAt: new Date().toISOString(),
		checkedAt: new Date().toISOString(),
	}),
) {
	let services = 0;
	let requests = 0;
	const requested: string[] = [];
	const modules = {
		codexProvider: definitions[0],
		goProvider: definitions[1],
		commandProvider: definitions[2],
		createAuthResolver: (registry: { getProviderAuth: (id: string) => Promise<any> }) => async (id: string) =>
			(await registry.getProviderAuth(id))?.auth,
		fetchProvider: async (provider: { id: string }) => {
			requests++;
			requested.push(provider.id);
			return fetchResult(provider);
		},
		createUsageService: ({ fetchProvider, providers }: any) => {
			services++;
			let snapshot: any[] = [];
			let inFlight: Promise<any> | undefined;
			return {
				refresh: () => {
					if (!inFlight) {
						inFlight = Promise.resolve(fetchProvider(providers[0], { signal: new AbortController().signal }))
							.then((result) => {
								snapshot = [result];
								return snapshot;
							})
							.finally(() => {
								inFlight = undefined;
							});
					}
					return inFlight;
				},
				getSnapshot: () => snapshot,
				dispose: vi.fn(),
			};
		},
	};
	return { modules, stats: () => ({ services, requests }), requested };
}

function runtime(token: string | undefined): SubscriptionModelRuntime {
	return {
		getAuth: async () => (token ? { auth: { apiKey: token } } : undefined),
		getProvider: () => undefined,
		getRegisteredNativeProvider: () => undefined,
	};
}

afterEach(() => {
	delete process.env.DISPATCH_USAGE_DISABLED;
	setSubscriptionUsageModuleLoaderForTests(undefined);
});

describe("subscription usage bridge", () => {
	it("shares per-account services and deduplicates concurrent tabs", async () => {
		const fake = fakeModules();
		setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
		const [a, b] = await Promise.all([
			subscriptionUsage.read(runtime("same")),
			subscriptionUsage.read(runtime("same")),
		]);
		expect(a.status).toBe("ready");
		expect(b.providers[0].state).toBe("ok");
		expect(fake.stats()).toEqual({ services: 3, requests: 3 });
	});

	it("hits a fresh cache without another provider request", async () => {
		const fake = fakeModules();
		setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
		await subscriptionUsage.read(runtime("same"));
		await subscriptionUsage.read(runtime("same"));
		expect(fake.stats()).toEqual({ services: 3, requests: 3 });
	});

	it("does not reuse an account after credentials switch", async () => {
		const fake = fakeModules();
		setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
		await subscriptionUsage.read(runtime("first"));
		await subscriptionUsage.read(runtime("second"));
		expect(fake.stats().services).toBe(6);
	});

	it("refreshes cached rows once they are older than three minutes", async () => {
		const fake = fakeModules((provider) => ({
			providerId: provider.id,
			displayName: provider.id,
			state: "ok",
			windows: [],
			fetchedAt: "2020-01-01T00:00:00.000Z",
			checkedAt: "2020-01-01T00:00:00.000Z",
		}));
		setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
		await subscriptionUsage.read(runtime("token"));
		await subscriptionUsage.read(runtime("token"));
		expect(fake.stats().requests).toBe(6);
	});

	it("refreshes only the requested provider and redacts unknown errors", async () => {
		const fake = fakeModules((provider) => ({
			providerId: provider.id,
			displayName: provider.id,
			state: "unavailable",
			windows: [],
			fetchedAt: null,
			checkedAt: new Date().toISOString(),
			error: "secret stack trace",
		}));
		setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
		const result = await subscriptionUsage.refresh(runtime("token"), "openai-codex");
		expect(fake.stats().requests).toBe(1);
		expect(fake.requested).toEqual(["openai-codex"]);
		expect(result.providers[0].error).toBeUndefined();
	});

	it("guards repeated successful manual refreshes across tabs without bypassing longer provider cooldowns", async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeModules();
			setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
			const first = await subscriptionUsage.refresh(runtime("token"), "openai-codex");
			expect(Date.parse(first.providers[0].retryAt!)).toBe(Date.now() + 10_000);
			await subscriptionUsage.refresh(runtime("token"), "openai-codex");
			expect(fake.stats().requests).toBe(1);
			await vi.advanceTimersByTimeAsync(10_001);
			await subscriptionUsage.refresh(runtime("token"), "openai-codex");
			expect(fake.stats().requests).toBe(2);
			const deadline = new Date(Date.now() + 60_000).toISOString();
			const limited = fakeModules((provider) => ({
				providerId: provider.id,
				state: "unavailable",
				windows: [],
				checkedAt: new Date().toISOString(),
				retryAt: deadline,
				error: "RATE_LIMITED",
			}));
			setSubscriptionUsageModuleLoaderForTests(async () => limited.modules as any);
			const result = await subscriptionUsage.refresh(runtime("token"), "openai-codex");
			expect(result.providers[0].retryAt).toBe(deadline);
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds parallel SDK auth resolution, including a hung resolver", async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeModules();
			setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
			const hanging: SubscriptionModelRuntime = {
				getAuth: async () => new Promise(() => {}),
				getProvider: () => undefined,
				getRegisteredNativeProvider: () => undefined,
			};
			const pending = subscriptionUsage.read(hanging);
			await vi.advanceTimersByTimeAsync(12_000);
			const result = await pending;
			expect(result.status).toBe("ready");
			expect(result.providers.every((provider) => provider.state === "unavailable")).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not retain old bars or expose raw auth/provider fields after logout", async () => {
		const fake = fakeModules((provider) => ({
			providerId: provider.id,
			displayName: provider.id,
			state: "ok",
			windows: [{ label: "quota", windowSeconds: 60, usedPercent: 42, resetsAt: null }],
			fetchedAt: new Date().toISOString(),
			checkedAt: new Date().toISOString(),
			accountKey: "private-account",
			error: "raw provider response secret",
		}));
		setSubscriptionUsageModuleLoaderForTests(async () => fake.modules as any);
		await subscriptionUsage.read(runtime("token"));
		const loggedOut: SubscriptionModelRuntime = {
			getAuth: async () => {
				throw new Error("raw auth failure");
			},
			getProvider: () => undefined,
			getRegisteredNativeProvider: () => undefined,
		};
		const result = await subscriptionUsage.read(loggedOut);
		const wire = JSON.stringify(result);
		expect(result.providers[0].windows).toEqual([]);
		expect(wire).not.toContain("private-account");
		expect(wire).not.toContain("raw provider response secret");
		expect(wire).not.toContain("raw auth failure");
	});

	it("supports disabled and missing installations", async () => {
		process.env.DISPATCH_USAGE_DISABLED = "1";
		setSubscriptionUsageModuleLoaderForTests(async () => undefined);
		expect((await subscriptionUsage.read(runtime("token"))).status).toBe("disabled");
		delete process.env.DISPATCH_USAGE_DISABLED;
		expect((await subscriptionUsage.read(runtime("token"))).status).toBe("unavailable");
	});
});
