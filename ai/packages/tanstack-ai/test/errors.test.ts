import { describe, expect, it, vi } from "vitest";
import {
	bindingErrorToResponse,
	DEFAULT_MAX_RETRIES,
	errorFromResponse,
	normalizeBindingError,
	parseRetryAfterMs,
	WorkersAiRequestError,
	withWorkersAiRetry,
} from "../src/utils/errors";

// ---------------------------------------------------------------------------
// normalizeBindingError
// ---------------------------------------------------------------------------

describe("normalizeBindingError", () => {
	it("maps an out-of-capacity (3040) binding error to a 429 WorkersAiRequestError", () => {
		const err = normalizeBindingError(
			new Error("3040: Capacity temporarily exceeded, please try again."),
			"Workers AI embedding",
		);
		expect(err).toBeInstanceOf(WorkersAiRequestError);
		const e = err as WorkersAiRequestError;
		expect(e.status).toBe(429);
		expect(e.message).toContain("Workers AI embedding request failed");
		expect(e.message).toContain("3040");
	});

	it("maps a client error (5007) to a 400 WorkersAiRequestError", () => {
		const err = normalizeBindingError(
			new Error("5007: No such model"),
			"x",
		) as WorkersAiRequestError;
		expect(err.status).toBe(400);
	});

	it("captures the recognized internal code", () => {
		const err = normalizeBindingError(
			new Error("3040: out of capacity"),
			"x",
		) as WorkersAiRequestError;
		expect(err.code).toBe(3040);
	});

	it("leaves unrecognized errors without a status (so they are not retried)", () => {
		const err = normalizeBindingError(
			new Error("totally unexpected"),
			"x",
		) as WorkersAiRequestError;
		expect(err).toBeInstanceOf(WorkersAiRequestError);
		expect(err.status).toBeUndefined();
	});

	it("passes AbortError / DOMException aborts through unchanged", () => {
		const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
		expect(normalizeBindingError(abort, "x")).toBe(abort);

		const domAbort = new DOMException("The operation was aborted", "AbortError");
		expect(normalizeBindingError(domAbort, "x")).toBe(domAbort);
	});

	it("passes an existing WorkersAiRequestError through unchanged", () => {
		const original = new WorkersAiRequestError("already wrapped", { status: 500 });
		expect(normalizeBindingError(original, "x")).toBe(original);
	});
});

// ---------------------------------------------------------------------------
// errorFromResponse
// ---------------------------------------------------------------------------

describe("errorFromResponse", () => {
	it("captures status + body and keeps the historical message shape", () => {
		const err = errorFromResponse(
			new Response("rate limited", { status: 429 }),
			"rate limited",
			"Workers AI embedding",
		);
		expect(err.status).toBe(429);
		expect(err.responseBody).toBe("rate limited");
		expect(err.message).toBe("Workers AI embedding request failed (429): rate limited");
	});

	it("parses Retry-After (delta-seconds) into retryAfterMs", () => {
		const err = errorFromResponse(
			new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }),
			"rate limited",
			"Workers AI embedding",
		);
		expect(err.retryAfterMs).toBe(2000);
	});
});

// ---------------------------------------------------------------------------
// parseRetryAfterMs
// ---------------------------------------------------------------------------

describe("parseRetryAfterMs", () => {
	it("parses delta-seconds", () => {
		expect(parseRetryAfterMs("3")).toBe(3000);
		expect(parseRetryAfterMs("0")).toBe(0);
	});

	it("parses an HTTP-date relative to now", () => {
		const now = Date.parse("2026-01-01T00:00:00Z");
		expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5000);
		// A past date clamps to 0 rather than going negative.
		expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:00 GMT", now + 10_000)).toBe(0);
	});

	it("returns undefined for missing / unparseable values", () => {
		expect(parseRetryAfterMs(null)).toBeUndefined();
		expect(parseRetryAfterMs("")).toBeUndefined();
		expect(parseRetryAfterMs("   ")).toBeUndefined();
		expect(parseRetryAfterMs("soon")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// bindingErrorToResponse (chat shim)
// ---------------------------------------------------------------------------

describe("bindingErrorToResponse", () => {
	it("turns a 3040 binding error into a 429 Response", () => {
		const res = bindingErrorToResponse(new Error("3040: out of capacity"));
		expect(res.status).toBe(429);
	});

	it("turns a 5007 binding error into a 400 Response", () => {
		const res = bindingErrorToResponse(new Error("5007: No such model"));
		expect(res.status).toBe(400);
	});

	it("re-throws aborts so the OpenAI SDK's cancellation handling fires", () => {
		const abort = new DOMException("aborted", "AbortError");
		expect(() => bindingErrorToResponse(abort)).toThrow(abort);
	});

	it("re-throws unrecognized errors (preserving the original, no fabricated status)", () => {
		const boom = new Error("unexpected kaboom");
		expect(() => bindingErrorToResponse(boom)).toThrow(boom);
	});
});

// ---------------------------------------------------------------------------
// withWorkersAiRetry
// ---------------------------------------------------------------------------

describe("withWorkersAiRetry", () => {
	it("returns the result without retrying on success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		await expect(withWorkersAiRetry(fn, { baseDelayMs: 0 })).resolves.toBe("ok");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries retryable failures (429) then succeeds", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new WorkersAiRequestError("rate limited", { status: 429 }))
			.mockResolvedValue("recovered");
		await expect(withWorkersAiRetry(fn, { baseDelayMs: 0 })).resolves.toBe("recovered");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("honors a server Retry-After hint when retrying", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(
				new WorkersAiRequestError("rate limited", { status: 429, retryAfterMs: 5 }),
			)
			.mockResolvedValue("recovered");
		await expect(withWorkersAiRetry(fn)).resolves.toBe("recovered");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("derives retryability from a raw binding 3040 error message", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("3040: out of capacity"))
			.mockResolvedValue("recovered");
		await expect(withWorkersAiRetry(fn, { baseDelayMs: 0 })).resolves.toBe("recovered");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("gives up after maxRetries and throws the last error", async () => {
		const error = new WorkersAiRequestError("still failing", { status: 503 });
		const fn = vi.fn().mockRejectedValue(error);
		await expect(withWorkersAiRetry(fn, { maxRetries: 2, baseDelayMs: 0 })).rejects.toBe(error);
		// 1 initial + 2 retries
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("does not retry non-retryable failures (e.g. 400)", async () => {
		const error = new WorkersAiRequestError("bad request", { status: 400 });
		const fn = vi.fn().mockRejectedValue(error);
		await expect(withWorkersAiRetry(fn, { baseDelayMs: 0 })).rejects.toBe(error);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("never retries aborts", async () => {
		const abort = new DOMException("aborted", "AbortError");
		const fn = vi.fn().mockRejectedValue(abort);
		await expect(withWorkersAiRetry(fn, { baseDelayMs: 0 })).rejects.toBe(abort);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("respects maxRetries: 0 (no retries)", async () => {
		const error = new WorkersAiRequestError("rate limited", { status: 429 });
		const fn = vi.fn().mockRejectedValue(error);
		await expect(withWorkersAiRetry(fn, { maxRetries: 0, baseDelayMs: 0 })).rejects.toBe(error);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("defaults to DEFAULT_MAX_RETRIES retries", async () => {
		const error = new WorkersAiRequestError("rate limited", { status: 429 });
		const fn = vi.fn().mockRejectedValue(error);
		await expect(withWorkersAiRetry(fn, { baseDelayMs: 0 })).rejects.toBe(error);
		expect(fn).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES + 1);
	});
});
