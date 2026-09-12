/**
 * Shared AI Gateway dispatch primitives: the `cf-aig-*` header builder, the
 * provider-key / hop-by-hop header strip, body decoding, and universal-endpoint
 * entry construction.
 *
 * These are consumed by `workers-ai-provider` (the gateway-path `createGatewayFetch`
 * and the delegate's `makeGatewayFetch`/`makeRunFetch`) and by `@cloudflare/tanstack-ai`
 * (its REST/binding `createGatewayFetch`), so there's a single place that knows how
 * to translate caching/metadata/log options into gateway headers.
 */

/** Metadata values the gateway accepts (`bigint` is serialized to a string). */
export type GatewayMetadata = Record<string, number | string | boolean | null | bigint>;

/** JSON-encode metadata for the `cf-aig-metadata` header (`bigint` → string). */
export function serializeMetadata(metadata: GatewayMetadata): string {
	return JSON.stringify(metadata, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** Hop-by-hop headers that must never be forwarded to the gateway. */
export const STRIP_HEADERS_BASE: readonly string[] = ["content-length", "host"];

/** Normalize any `HeadersInit` shape into a plain object. */
export function headersToObject(h: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!h) return out;
	if (h instanceof Headers) {
		for (const [k, v] of h) out[k] = v;
	} else if (Array.isArray(h)) {
		for (const [k, v] of h) out[k] = v;
	} else {
		Object.assign(out, h);
	}
	return out;
}

/** Best-effort decode of a request body to text for re-parsing as JSON. */
export function asText(body: BodyInit | null | undefined): string {
	if (typeof body === "string") return body;
	if (body instanceof Uint8Array) return new TextDecoder().decode(body);
	if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
	return "{}";
}

/** Retry controls that map onto the `cf-aig-*` retry headers. */
export interface GatewayRetryOptions {
	/** Max retry attempts → `cf-aig-max-attempts`. */
	maxAttempts?: number;
	/** Delay between retries (ms) → `cf-aig-retry-delay`. */
	retryDelayMs?: number;
	/** Backoff strategy → `cf-aig-backoff`. */
	backoff?: "constant" | "linear" | "exponential";
}

/**
 * Gateway request controls that map onto `cf-aig-*` request headers. Mirrors the
 * binding's `GatewayOptions` (the run path forwards those to `binding.run`) so the
 * gateway path reaches parity, plus the universal-endpoint-only `byokAlias`/`zdr`.
 */
export interface GatewayCacheOptions {
	/** Gateway-side response cache TTL (seconds) → `cf-aig-cache-ttl`. */
	cacheTtl?: number;
	/** Bypass the gateway cache → `cf-aig-skip-cache`. */
	skipCache?: boolean;
	/** Custom cache key → `cf-aig-cache-key`. */
	cacheKey?: string;
	/** Arbitrary log metadata → `cf-aig-metadata` (JSON). */
	metadata?: GatewayMetadata;
	/** Toggle gateway logging → `cf-aig-collect-log`. */
	collectLog?: boolean;
	/** Trace id for this event → `cf-aig-event-id`. */
	eventId?: string;
	/** Upstream provider timeout (ms) → `cf-aig-request-timeout`. */
	requestTimeoutMs?: number;
	/** Retry controls → `cf-aig-max-attempts` / `cf-aig-retry-delay` / `cf-aig-backoff`. */
	retries?: GatewayRetryOptions;
	/**
	 * BYOK stored-key alias to authenticate with → `cf-aig-byok-alias`. Selects a
	 * non-`default` key configured for the provider on the gateway.
	 */
	byokAlias?: string;
	/**
	 * Per-request Zero Data Retention override (Unified Billing only) → `cf-aig-zdr`.
	 * `true` forces ZDR-capable upstreams; `false` disables it for this request.
	 */
	zdr?: boolean;
}

/**
 * Set the `cf-aig-*` cache/log/request headers on `headers` for every option
 * that is defined. Mutates `headers` in place (callers pass the entry's header
 * object).
 */
export function applyGatewayCacheHeaders(
	headers: Record<string, string>,
	opts: GatewayCacheOptions,
): void {
	if (opts.cacheTtl !== undefined) headers["cf-aig-cache-ttl"] = String(opts.cacheTtl);
	if (opts.skipCache) headers["cf-aig-skip-cache"] = "true";
	if (opts.cacheKey !== undefined) headers["cf-aig-cache-key"] = opts.cacheKey;
	if (opts.metadata) headers["cf-aig-metadata"] = serializeMetadata(opts.metadata);
	if (opts.collectLog !== undefined) headers["cf-aig-collect-log"] = String(opts.collectLog);
	if (opts.eventId !== undefined) headers["cf-aig-event-id"] = opts.eventId;
	if (opts.requestTimeoutMs !== undefined)
		headers["cf-aig-request-timeout"] = String(opts.requestTimeoutMs);
	if (opts.byokAlias !== undefined) headers["cf-aig-byok-alias"] = opts.byokAlias;
	if (opts.zdr !== undefined) headers["cf-aig-zdr"] = String(opts.zdr);
	if (opts.retries) {
		const { maxAttempts, retryDelayMs, backoff } = opts.retries;
		if (maxAttempts !== undefined) headers["cf-aig-max-attempts"] = String(maxAttempts);
		if (retryDelayMs !== undefined) headers["cf-aig-retry-delay"] = String(retryDelayMs);
		if (backoff !== undefined) headers["cf-aig-backoff"] = backoff;
	}
}

/** A single AI Gateway universal-endpoint request entry. */
export interface GatewayEntry {
	provider: string;
	endpoint: string;
	headers: Record<string, string>;
	query: Record<string, unknown>;
}

export interface BuildGatewayEntryParams {
	/** Gateway provider id (e.g. `"openai"`, `"google-vertex-ai"`). */
	providerId: string;
	/** Already host-stripped endpoint path (+ query). */
	endpoint: string;
	/** Incoming request headers from the wrapped provider SDK. */
	initHeaders: HeadersInit | undefined;
	/** Parsed request body, forwarded verbatim as `query`. */
	body: Record<string, unknown>;
	/**
	 * Provider auth header names to strip (e.g. the registry `authHeaders`) so the
	 * gateway's stored key / unified billing authenticates upstream. Omit for BYOK.
	 */
	stripAuthHeaders?: readonly string[];
	/** Extra headers added after stripping. */
	extraHeaders?: Record<string, string>;
	/** Cache / log controls. */
	cache?: GatewayCacheOptions;
}

/**
 * Assemble a single gateway entry: strip hop-by-hop + provider-auth headers,
 * layer on `extraHeaders` and `cf-aig-*` cache headers, and attach the body as
 * `query`. Endpoint derivation stays with the caller because the gateway-path
 * (registry host-strip) and the REST path (`/v1/` strip) differ.
 */
export function buildGatewayEntry(params: BuildGatewayEntryParams): GatewayEntry {
	const strip = new Set<string>(STRIP_HEADERS_BASE);
	if (params.stripAuthHeaders) {
		for (const h of params.stripAuthHeaders) strip.add(h.toLowerCase());
	}

	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(headersToObject(params.initHeaders))) {
		if (!strip.has(k.toLowerCase())) headers[k] = v;
	}
	if (params.extraHeaders) Object.assign(headers, params.extraHeaders);
	if (params.cache) applyGatewayCacheHeaders(headers, params.cache);

	return {
		provider: params.providerId,
		endpoint: params.endpoint,
		headers,
		query: params.body,
	};
}
