import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { registerSubscriptionRoutes } from "../../server/subscriptions-http.js";

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function host(originAllowed = true) {
	const getSubscriptions = vi.fn(async (_provider?: string) => ({
		status: "ready" as const,
		providers: [],
		refreshAfterMs: 180_000,
	}));
	const app = express();
	app.use(express.json());
	registerSubscriptionRoutes(
		app,
		(id) => (id === "client" ? { getSubscriptions } : undefined),
		() => originAllowed,
	);
	const server = createServer(app);
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as { port: number };
	return { url: `http://127.0.0.1:${address.port}/api/subscriptions`, getSubscriptions };
}

describe("subscription HTTP bridge", () => {
	it("returns snapshots without HTTP caching and scopes refresh to one provider", async () => {
		const { url, getSubscriptions } = await host();
		const response = await fetch(`${url}?clientId=client`);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ status: "ready", providers: [], refreshAfterMs: 180_000 });
		expect(getSubscriptions).toHaveBeenLastCalledWith(undefined);
		const refresh = await fetch(`${url}?clientId=client`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ providerId: "openai-codex" }),
		});
		expect(refresh.status).toBe(200);
		expect(getSubscriptions).toHaveBeenLastCalledWith("openai-codex");
	});

	it("rejects unknown sessions and providers before accessing credentials", async () => {
		const { url, getSubscriptions } = await host();
		expect((await fetch(url)).status).toBe(409);
		expect(
			(
				await fetch(`${url}?clientId=client`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ providerId: "bad" }),
				})
			).status,
		).toBe(400);
		expect(getSubscriptions).not.toHaveBeenCalled();
	});

	it("rejects cross-origin access and redacts server errors", async () => {
		const denied = await host(false);
		expect((await fetch(`${denied.url}?clientId=client`)).status).toBe(403);
		expect(denied.getSubscriptions).not.toHaveBeenCalled();
		const allowed = await host();
		expect(
			(await fetch(`${allowed.url}?clientId=client`, { headers: { "Sec-Fetch-Site": "cross-site" } })).status,
		).toBe(403);
		allowed.getSubscriptions.mockRejectedValueOnce(new Error("secret credential"));
		const response = await fetch(`${allowed.url}?clientId=client`);
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("secret credential");
	});
});
