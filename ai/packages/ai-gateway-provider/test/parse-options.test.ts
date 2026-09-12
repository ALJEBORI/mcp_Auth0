import { describe, expect, it } from "vitest";
import { parseAiGatewayOptions } from "../src";

describe("parseAiGatewayOptions", () => {
	it("maps every option to its cf-aig-* header", () => {
		const headers = parseAiGatewayOptions({
			cacheTtl: 3600,
			skipCache: true,
			cacheKey: "my-key",
			metadata: { userId: "u1", count: 3, flag: true },
			collectLog: false,
			eventId: "evt-1",
			requestTimeoutMs: 5000,
			retries: { maxAttempts: 3, retryDelayMs: 1000, backoff: "exponential" },
			byokAlias: "alias-1",
			zdr: true,
		});

		expect(headers.get("cf-aig-cache-ttl")).toBe("3600");
		expect(headers.get("cf-aig-skip-cache")).toBe("true");
		expect(headers.get("cf-aig-cache-key")).toBe("my-key");
		expect(headers.get("cf-aig-metadata")).toBe(
			JSON.stringify({ userId: "u1", count: 3, flag: true }),
		);
		expect(headers.get("cf-aig-collect-log")).toBe("false");
		expect(headers.get("cf-aig-event-id")).toBe("evt-1");
		expect(headers.get("cf-aig-request-timeout")).toBe("5000");
		expect(headers.get("cf-aig-max-attempts")).toBe("3");
		expect(headers.get("cf-aig-retry-delay")).toBe("1000");
		expect(headers.get("cf-aig-backoff")).toBe("exponential");
		expect(headers.get("cf-aig-byok-alias")).toBe("alias-1");
		expect(headers.get("cf-aig-zdr")).toBe("true");
	});

	it("serializes bigint metadata to a string", () => {
		const headers = parseAiGatewayOptions({ metadata: { big: 10n } });
		expect(headers.get("cf-aig-metadata")).toBe(JSON.stringify({ big: "10" }));
	});

	it("emits no headers for empty options", () => {
		const headers = parseAiGatewayOptions({});
		expect([...headers.keys()]).toEqual([]);
	});

	it("uses the current cf-aig-* cache names, not the deprecated cf-cache-ttl / cf-skip-cache", () => {
		const headers = parseAiGatewayOptions({ cacheTtl: 60, skipCache: true });
		expect(headers.get("cf-cache-ttl")).toBeNull();
		expect(headers.get("cf-skip-cache")).toBeNull();
		expect(headers.get("cf-aig-cache-ttl")).toBe("60");
		expect(headers.get("cf-aig-skip-cache")).toBe("true");
	});

	it("omits skip-cache when explicitly false", () => {
		const headers = parseAiGatewayOptions({ skipCache: false });
		expect(headers.get("cf-aig-skip-cache")).toBeNull();
	});

	it("emits each retry sub-field independently", () => {
		const headers = parseAiGatewayOptions({ retries: { maxAttempts: 2 } });
		expect(headers.get("cf-aig-max-attempts")).toBe("2");
		expect(headers.get("cf-aig-retry-delay")).toBeNull();
		expect(headers.get("cf-aig-backoff")).toBeNull();
	});
});
