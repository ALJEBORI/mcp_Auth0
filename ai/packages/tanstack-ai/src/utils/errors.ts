import {
	isAbortError,
	isRetryableStatus,
	messageOf,
	parseWorkersAIErrorCode,
	workersAIStatusFromError,
} from "@cloudflare/gateway-core";

/**
 * Default number of automatic retries for the non-chat adapters' bounded retry
 * loop. Matches the OpenAI SDK default used on the chat path so behavior is
 * consistent across activities.
 */
export const DEFAULT_MAX_RETRIES = 2;

/** Hard cap on a server-provided `Retry-After` so a hostile/huge value can't hang a request. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Error thrown by the non-chat Workers AI adapters (embedding, image, TTS,
 * transcription, summarize) when a request fails.
 *
 * Unlike the chat path — which runs through the OpenAI SDK and surfaces
 * `OpenAI.APIError` — these adapters talk to the binding / REST / gateway
 * directly, so we normalize failures into this single shape. The `status`
 * (when known) drives {@link withWorkersAiRetry}; `code` carries the raw
 * Workers AI internal error code when one was recognized; `retryAfterMs` carries
 * a parsed `Retry-After` so the retry loop can honor the server's hint.
 */
export class WorkersAiRequestError extends Error {
	override readonly name = "WorkersAiRequestError";
	readonly status?: number;
	readonly code?: number;
	readonly responseBody?: string;
	readonly retryAfterMs?: number;
	override readonly cause?: unknown;

	constructor(
		message: string,
		options?: {
			status?: number;
			code?: number;
			responseBody?: string;
			retryAfterMs?: number;
			cause?: unknown;
		},
	) {
		super(message);
		this.status = options?.status;
		this.code = options?.code;
		this.responseBody = options?.responseBody;
		this.retryAfterMs = options?.retryAfterMs;
		this.cause = options?.cause;
	}
}

/**
 * Parse an HTTP `Retry-After` header value into milliseconds. Supports both
 * forms from RFC 7231: delta-seconds (e.g. `"3"`) and an HTTP-date. Returns
 * `undefined` when absent or unparseable.
 */
export function parseRetryAfterMs(
	value: string | null,
	now: number = Date.now(),
): number | undefined {
	if (value == null) return undefined;
	const trimmed = value.trim();
	if (trimmed === "") return undefined;
	// delta-seconds
	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed) * 1000;
	}
	// HTTP-date
	const date = Date.parse(trimmed);
	if (Number.isFinite(date)) {
		return Math.max(0, date - now);
	}
	return undefined;
}

/**
 * Best-effort HTTP status for any thrown value: prefers an explicit `status`
 * (our own {@link WorkersAiRequestError} or an HTTP-shaped error), otherwise
 * derives one from a recognized Workers AI binding error code.
 */
function statusOf(error: unknown): number | undefined {
	if (error && typeof error === "object") {
		const status = (error as { status?: unknown }).status;
		if (typeof status === "number") return status;
	}
	return workersAIStatusFromError(error);
}

/**
 * Normalize an error thrown by a Workers AI **binding** call into a
 * {@link WorkersAiRequestError}. Cancellations (`AbortError` / `TimeoutError` /
 * `ResponseAborted`, including `DOMException` aborts) and errors that are
 * already a `WorkersAiRequestError` propagate untouched. Recognized internal
 * codes get the documented HTTP `status` (so the retry loop can classify them);
 * unrecognized failures get no status and are therefore not retried.
 */
export function normalizeBindingError(error: unknown, label: string): unknown {
	if (isAbortError(error) || error instanceof WorkersAiRequestError) {
		return error;
	}
	const code = parseWorkersAIErrorCode(error);
	const status = workersAIStatusFromError(error);
	const message = messageOf(error);
	return new WorkersAiRequestError(`${label} request failed: ${message}`, {
		status,
		...(code != null ? { code } : {}),
		cause: error,
	});
}

/**
 * Build a {@link WorkersAiRequestError} from a non-OK Workers AI **REST** /
 * **gateway** `Response`. The HTTP status is authoritative, so it drives
 * retryability directly, and `Retry-After` is preserved so the retry loop can
 * honor it. The message keeps the historical
 * `"<label> request failed (<status>): <body>"` shape that callers (and tests)
 * already rely on.
 */
export function errorFromResponse(
	response: Response,
	body: string,
	label: string,
): WorkersAiRequestError {
	const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
	return new WorkersAiRequestError(`${label} request failed (${response.status}): ${body}`, {
		status: response.status,
		responseBody: body,
		...(retryAfterMs != null ? { retryAfterMs } : {}),
	});
}

/**
 * Convert an error thrown by the Workers AI **binding** inside the OpenAI chat
 * shim into an HTTP `Response`, so the OpenAI SDK's status-based retry/error
 * handling engages (it retries 408 / 409 / 429 / >= 500, honoring `Retry-After`).
 *
 * Aborts are re-thrown so the SDK's cancellation handling fires. Errors with no
 * recognized Workers AI code are also re-thrown: the SDK wraps them as a
 * retryable `APIConnectionError`, preserving the original error/stack rather
 * than fabricating a misleading HTTP status.
 */
export function bindingErrorToResponse(error: unknown): Response {
	if (isAbortError(error)) throw error;
	const status = workersAIStatusFromError(error);
	if (status == null) throw error;
	const message = messageOf(error);
	const code = parseWorkersAIErrorCode(error);
	// OpenAI-shaped error body so the SDK surfaces `error.message` cleanly.
	const body = JSON.stringify({
		error: {
			message,
			type: "workers_ai_error",
			...(code != null ? { code } : {}),
		},
	});
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Sleep helper that resolves after `ms` milliseconds (overridable in tests). */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying on transient failures with exponential backoff + full
 * jitter. A failure is retryable when its (explicit or derived) HTTP status is
 * in the retryable set (408 / 409 / 429 / >= 500). Aborts are never retried.
 *
 * This is the non-chat counterpart to the OpenAI SDK's built-in retry: the chat
 * adapter gets retries for free from the SDK, while embedding / image / TTS /
 * transcription / summarize call the binding, REST, or gateway directly and
 * have no such layer.
 */
export async function withWorkersAiRetry<T>(
	fn: () => Promise<T>,
	options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
	const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
	const baseDelayMs = options?.baseDelayMs ?? 250;

	let attempt = 0;
	for (;;) {
		try {
			return await fn();
		} catch (error) {
			if (isAbortError(error)) throw error;
			const status = statusOf(error);
			const retryable = status != null && isRetryableStatus(status);
			if (!retryable || attempt >= maxRetries) throw error;

			// Prefer a server-provided Retry-After (capped); otherwise exponential
			// backoff with full jitter, capped at 2s.
			const retryAfterMs =
				error instanceof WorkersAiRequestError ? error.retryAfterMs : undefined;
			const wait =
				retryAfterMs != null
					? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS)
					: Math.random() * Math.min(baseDelayMs * 2 ** attempt, 2000);
			await delay(wait);
			attempt++;
		}
	}
}
