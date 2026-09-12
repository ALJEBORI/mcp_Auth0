import { describe, expect, it } from "vitest";
import {
	applyGatewayCacheHeaders,
	asText,
	buildGatewayEntry,
	headersToObject,
	serializeMetadata,
	STRIP_HEADERS_BASE,
} from "../src/gateway-fetch";

describe("serializeMetadata", () => {
	it("JSON-encodes values and coerces bigint to string", () => {
		const json = serializeMetadata({ tenant: "acme", count: 3, big: 9007199254740993n });
		expect(JSON.parse(json)).toEqual({ tenant: "acme", count: 3, big: "9007199254740993" });
	});
});

describe("headersToObject", () => {
	it("returns {} for undefined", () => {
		expect(headersToObject(undefined)).toEqual({});
	});

	it("flattens a Headers instance", () => {
		const h = new Headers({ "content-type": "application/json", authorization: "Bearer x" });
		expect(headersToObject(h)).toEqual({
			"content-type": "application/json",
			authorization: "Bearer x",
		});
	});

	it("flattens an array of tuples", () => {
		expect(
			headersToObject([
				["a", "1"],
				["b", "2"],
			]),
		).toEqual({ a: "1", b: "2" });
	});

	it("passes through a plain record", () => {
		expect(headersToObject({ a: "1" })).toEqual({ a: "1" });
	});
});

describe("asText", () => {
	it("returns strings verbatim", () => {
		expect(asText('{"a":1}')).toBe('{"a":1}');
	});

	it("decodes Uint8Array + ArrayBuffer", () => {
		const bytes = new TextEncoder().encode('{"x":2}');
		expect(asText(bytes)).toBe('{"x":2}');
		expect(asText(bytes.buffer)).toBe('{"x":2}');
	});

	it("falls back to {} for unsupported bodies", () => {
		expect(asText(undefined)).toBe("{}");
		expect(asText(null)).toBe("{}");
	});
});

describe("applyGatewayCacheHeaders", () => {
	it("writes every defined cf-aig-* header", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, {
			cacheTtl: 120,
			skipCache: true,
			cacheKey: "k1",
			metadata: { tenant: "acme", big: 5n },
			collectLog: false,
		});
		expect(headers).toEqual({
			"cf-aig-cache-ttl": "120",
			"cf-aig-skip-cache": "true",
			"cf-aig-cache-key": "k1",
			"cf-aig-metadata": '{"tenant":"acme","big":"5"}',
			"cf-aig-collect-log": "false",
		});
	});

	it("omits headers for undefined options (and false skipCache)", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, { skipCache: false });
		expect(headers).toEqual({});
	});

	it("emits cf-aig-collect-log:true when explicitly enabled", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, { collectLog: true });
		expect(headers["cf-aig-collect-log"]).toBe("true");
	});

	it("writes event-id, request-timeout, byok-alias, and zdr headers", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, {
			eventId: "evt-123",
			requestTimeoutMs: 5000,
			byokAlias: "production",
			zdr: true,
		});
		expect(headers).toEqual({
			"cf-aig-event-id": "evt-123",
			"cf-aig-request-timeout": "5000",
			"cf-aig-byok-alias": "production",
			"cf-aig-zdr": "true",
		});
	});

	it("emits cf-aig-zdr:false when ZDR is explicitly disabled", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, { zdr: false });
		expect(headers["cf-aig-zdr"]).toBe("false");
	});

	it("maps the retries trio to cf-aig-* headers", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, {
			retries: { maxAttempts: 3, retryDelayMs: 250, backoff: "exponential" },
		});
		expect(headers).toEqual({
			"cf-aig-max-attempts": "3",
			"cf-aig-retry-delay": "250",
			"cf-aig-backoff": "exponential",
		});
	});

	it("omits retry headers that are not set", () => {
		const headers: Record<string, string> = {};
		applyGatewayCacheHeaders(headers, { retries: { maxAttempts: 2 } });
		expect(headers).toEqual({ "cf-aig-max-attempts": "2" });
	});
});

describe("buildGatewayEntry", () => {
	const baseBody = { model: "gpt-5", messages: [] };

	it("maps provider id + endpoint and forwards the body as query", () => {
		const entry = buildGatewayEntry({
			providerId: "openai",
			endpoint: "v1/chat/completions",
			initHeaders: { "content-type": "application/json" },
			body: baseBody,
		});
		expect(entry.provider).toBe("openai");
		expect(entry.endpoint).toBe("v1/chat/completions");
		expect(entry.query).toEqual(baseBody);
		expect(entry.headers["content-type"]).toBe("application/json");
	});

	it("strips hop-by-hop + provider-auth headers by default", () => {
		const entry = buildGatewayEntry({
			providerId: "openai",
			endpoint: "v1/chat/completions",
			initHeaders: {
				authorization: "Bearer sk-x",
				"content-length": "42",
				host: "api.openai.com",
				"x-keep": "yes",
			},
			body: baseBody,
			stripAuthHeaders: ["authorization"],
		});
		expect(entry.headers.authorization).toBeUndefined();
		expect(entry.headers["content-length"]).toBeUndefined();
		expect(entry.headers.host).toBeUndefined();
		expect(entry.headers["x-keep"]).toBe("yes");
	});

	it("keeps the auth header when stripAuthHeaders is omitted (BYOK)", () => {
		const entry = buildGatewayEntry({
			providerId: "deepseek",
			endpoint: "v1/chat/completions",
			initHeaders: { authorization: "Bearer real" },
			body: baseBody,
			extraHeaders: { authorization: "Bearer real" },
		});
		expect(entry.headers.authorization).toBe("Bearer real");
	});

	it("layers extraHeaders + cache headers on the entry", () => {
		const entry = buildGatewayEntry({
			providerId: "openai",
			endpoint: "v1/chat/completions",
			initHeaders: {},
			body: baseBody,
			extraHeaders: { "x-tenant": "acme" },
			cache: { cacheTtl: 60, metadata: { run: 1 } },
		});
		expect(entry.headers["x-tenant"]).toBe("acme");
		expect(entry.headers["cf-aig-cache-ttl"]).toBe("60");
		expect(entry.headers["cf-aig-metadata"]).toBe('{"run":1}');
	});

	it("strip set is case-insensitive and includes the hop-by-hop base", () => {
		expect(STRIP_HEADERS_BASE).toContain("host");
		expect(STRIP_HEADERS_BASE).toContain("content-length");
		const entry = buildGatewayEntry({
			providerId: "openai",
			endpoint: "v1/chat/completions",
			initHeaders: { Authorization: "Bearer sk", HOST: "x" },
			body: baseBody,
			stripAuthHeaders: ["authorization"],
		});
		expect(Object.keys(entry.headers)).toHaveLength(0);
	});
});
