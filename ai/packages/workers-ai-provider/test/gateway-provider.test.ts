import { describe, expect, it, vi } from "vitest";
import { WorkersAIGatewayError } from "../src/errors";
import { createGatewayFetch, createGatewayProvider } from "../src/gateway-provider";

interface GwCall {
	id: string;
	entries: Array<{
		provider: string;
		endpoint: string;
		headers: Record<string, string>;
		query: unknown;
	}>;
	options: Record<string, unknown>;
}

function makeBinding(): { binding: Ai; gwCalls: GwCall[] } {
	const gwCalls: GwCall[] = [];
	const binding = {
		gateway: vi.fn((id: string) => ({
			run: vi.fn(
				async (entries: GwCall["entries"], options: Record<string, unknown> = {}) => {
					gwCalls.push({ id, entries, options });
					return new Response("ok");
				},
			),
		})),
	} as unknown as Ai;
	return { binding, gwCalls };
}

const REQ = {
	method: "POST",
	headers: { authorization: "Bearer sk-real", "content-type": "application/json" },
	body: JSON.stringify({ model: "gpt-5", messages: [] }),
};

describe("createGatewayFetch (bring-your-own-provider)", () => {
	it("detects the provider from the URL and shapes the gateway entry", async () => {
		const { binding, gwCalls } = makeBinding();
		const f = createGatewayFetch({ binding, gateway: "gw-1" });
		await f("https://api.openai.com/v1/chat/completions", REQ);

		expect(gwCalls).toHaveLength(1);
		const [entry] = gwCalls[0].entries;
		expect(entry.provider).toBe("openai");
		expect(entry.endpoint).toBe("v1/chat/completions");
		// auth stripped by default (unified billing)
		expect(entry.headers.authorization).toBeUndefined();
		expect(entry.query).toEqual({ model: "gpt-5", messages: [] });
	});

	it("forwards the auth header when byok is set", async () => {
		const { binding, gwCalls } = makeBinding();
		const f = createGatewayFetch({ binding, gateway: "gw-1", byok: true });
		await f("https://api.deepseek.com/v1/chat/completions", REQ);
		expect(gwCalls[0].entries[0].provider).toBe("deepseek");
		expect(gwCalls[0].entries[0].headers.authorization).toBe("Bearer sk-real");
	});

	it("uses an explicit provider id without URL detection", async () => {
		const { binding, gwCalls } = makeBinding();
		const f = createGatewayFetch({ binding, gateway: "gw-1", provider: "my-custom" });
		await f("https://unknown.example.com/v1/run", REQ);
		expect(gwCalls[0].entries[0].provider).toBe("my-custom");
		expect(gwCalls[0].entries[0].endpoint).toBe("v1/run");
	});

	it("throws when it cannot detect a provider and none is given", async () => {
		const { binding } = makeBinding();
		const f = createGatewayFetch({ binding, gateway: "gw-1" });
		await expect(f("https://unknown.example.com/v1/run", REQ)).rejects.toBeInstanceOf(
			WorkersAIGatewayError,
		);
	});

	it("passes an abort signal through", async () => {
		const { binding, gwCalls } = makeBinding();
		const f = createGatewayFetch({ binding, gateway: "gw-1" });
		const controller = new AbortController();
		await f("https://api.openai.com/v1/chat/completions", {
			...REQ,
			signal: controller.signal,
		});
		expect(gwCalls[0].options.signal).toBe(controller.signal);
	});

	it("writes cache-control headers", async () => {
		const { binding, gwCalls } = makeBinding();
		const f = createGatewayFetch({ binding, gateway: "gw-1", cacheTtl: 60, skipCache: true });
		await f("https://api.openai.com/v1/chat/completions", REQ);
		expect(gwCalls[0].entries[0].headers["cf-aig-cache-ttl"]).toBe("60");
		expect(gwCalls[0].entries[0].headers["cf-aig-skip-cache"]).toBe("true");
	});

	it("requires a binding and gateway", () => {
		expect(() => createGatewayFetch({ gateway: "x" } as never)).toThrow(/requires a `binding`/);
		const { binding } = makeBinding();
		expect(() => createGatewayFetch({ binding } as never)).toThrow(/requires a `gateway`/);
	});
});

describe("createGatewayProvider", () => {
	it("injects the gateway fetch + placeholder key into a provider factory", () => {
		const { binding } = makeBinding();
		const factory = vi.fn((opts: { apiKey?: string; fetch: typeof globalThis.fetch }) => opts);
		const provider = createGatewayProvider(factory, { binding, gateway: "gw-1" });
		expect(factory).toHaveBeenCalledOnce();
		expect(provider.apiKey).toBe("unused");
		expect(typeof provider.fetch).toBe("function");
	});

	it("forwards a real key + baseURL when supplied", () => {
		const { binding } = makeBinding();
		const factory = vi.fn(
			(opts: { apiKey?: string; baseURL?: string; fetch: typeof globalThis.fetch }) => opts,
		);
		const provider = createGatewayProvider(factory, {
			binding,
			gateway: "gw-1",
			apiKey: "sk-real",
			baseURL: "https://api.openai.com",
			byok: true,
		});
		expect(provider.apiKey).toBe("sk-real");
		expect(provider.baseURL).toBe("https://api.openai.com");
	});
});
