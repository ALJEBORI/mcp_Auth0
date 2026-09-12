import { describe, expect, it } from "vitest";
import {
	classifyStatus,
	extractErrorMessage,
	type FallbackAttempt,
	WorkersAIFallbackError,
	WorkersAIGatewayError,
} from "../src/errors";

describe("classifyStatus", () => {
	it("classifies auth failures as non-recoverable", () => {
		expect(classifyStatus(401)).toEqual({ code: "auth", recoverable: false });
		expect(classifyStatus(403)).toEqual({ code: "auth", recoverable: false });
	});

	it("classifies rate limits + 5xx as recoverable", () => {
		expect(classifyStatus(429)).toEqual({ code: "rate-limit", recoverable: true });
		expect(classifyStatus(500)).toEqual({ code: "provider-error", recoverable: true });
		expect(classifyStatus(503)).toEqual({ code: "provider-error", recoverable: true });
	});

	it("classifies client errors as non-recoverable", () => {
		expect(classifyStatus(400)).toEqual({ code: "bad-request", recoverable: false });
		expect(classifyStatus(404)).toEqual({ code: "not-found", recoverable: false });
		expect(classifyStatus(422)).toEqual({ code: "bad-request", recoverable: false });
	});
});

describe("extractErrorMessage", () => {
	it("parses the CF gateway envelope { errors: [{ message }] }", () => {
		expect(extractErrorMessage('{"errors":[{"code":1,"message":"boom"}]}')).toBe("boom");
	});

	it("parses provider envelopes { error: { message } }", () => {
		expect(extractErrorMessage({ error: { message: "bad key" } })).toBe("bad key");
		expect(extractErrorMessage({ error: "plain" })).toBe("plain");
		expect(extractErrorMessage({ message: "top" })).toBe("top");
	});

	it("falls back to trimmed raw text", () => {
		expect(extractErrorMessage("not json")).toBe("not json");
		expect(extractErrorMessage("   ")).toBeUndefined();
	});
});

describe("WorkersAIGatewayError.fromResponse", () => {
	it("classifies + extracts a message from the body", async () => {
		const resp = new Response('{"errors":[{"message":"rate limited"}]}', {
			status: 429,
			headers: { "cf-aig-log-id": "log-9" },
		});
		const err = await WorkersAIGatewayError.fromResponse(resp, { provider: "openai" });
		expect(err.code).toBe("rate-limit");
		expect(err.recoverable).toBe(true);
		expect(err.status).toBe(429);
		expect(err.message).toBe("rate limited");
		expect(err.context.provider).toBe("openai");
		expect(err.context.logId).toBe("log-9");
	});

	it("uses a default message when the body has none", async () => {
		const err = await WorkersAIGatewayError.fromResponse(new Response("", { status: 401 }));
		expect(err.code).toBe("auth");
		expect(err.message).toMatch(/HTTP 401/);
	});
});

describe("WorkersAIGatewayError.fromUnknown", () => {
	it("classifies an AI SDK APICallError (statusCode + responseBody)", () => {
		const apiErr = Object.assign(new Error("Request failed"), {
			name: "AI_APICallError",
			statusCode: 401,
			responseBody: '{"error":{"message":"invalid key"}}',
			isRetryable: false,
		});
		const err = WorkersAIGatewayError.fromUnknown(apiErr);
		expect(err.code).toBe("auth");
		expect(err.recoverable).toBe(false);
		expect(err.status).toBe(401);
		expect(err.message).toBe("invalid key");
	});

	it("prefers the AI SDK isRetryable hint over the status default", () => {
		const apiErr = Object.assign(new Error("teapot"), { statusCode: 418, isRetryable: true });
		expect(WorkersAIGatewayError.fromUnknown(apiErr).recoverable).toBe(true);
	});

	it("treats a status-less transport error as a recoverable gateway-error", () => {
		const err = WorkersAIGatewayError.fromUnknown(new Error("socket hang up"));
		expect(err.code).toBe("gateway-error");
		expect(err.recoverable).toBe(true);
		expect(err.message).toBe("socket hang up");
	});

	it("passes a WorkersAIGatewayError through unchanged", () => {
		const orig = new WorkersAIGatewayError("rate-limit", "429", { status: 429 });
		expect(WorkersAIGatewayError.fromUnknown(orig)).toBe(orig);
	});
});

describe("WorkersAIFallbackError", () => {
	it("summarizes the chain and exposes the last error", () => {
		const e1 = new WorkersAIGatewayError("rate-limit", "429", { status: 429 });
		const e2 = new WorkersAIGatewayError("auth", "401", { status: 401 });
		const attempts: FallbackAttempt[] = [
			{ model: "openai/gpt-5", transport: "run", ok: false, status: 429, error: e1 },
			{ model: "anthropic/claude", transport: "run", ok: false, status: 401, error: e2 },
		];
		const err = new WorkersAIFallbackError(attempts);
		expect(err.message).toMatch(/openai\/gpt-5 → anthropic\/claude/);
		expect(err.attempts).toHaveLength(2);
		expect(err.lastError).toBe(e2);
	});
});
