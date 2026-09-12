import {
	OpenRouterTextAdapter,
	OpenRouterImageAdapter,
	createOpenRouterSummarize as createOpenRouterSummarizeAdapter,
	type OpenRouterConfig,
	type OpenRouterImageConfig,
} from "@tanstack/ai-openrouter";
import { HTTPClient } from "@openrouter/sdk";
import { createGatewayFetch, type AiGatewayAdapterConfig } from "../utils/create-fetcher";
import type { AnySummarizeAdapter, AnyTextAdapter } from "@tanstack/ai";

export type OpenRouterGatewayConfig = AiGatewayAdapterConfig;

/**
 * Build OpenRouter config that routes requests through AI Gateway.
 *
 * The OpenRouter SDK accepts an `httpClient` with a custom `fetcher`,
 * which we use to inject the AI Gateway fetch.
 */
function buildOpenRouterConfig(config: OpenRouterGatewayConfig): OpenRouterConfig {
	const httpClient = new HTTPClient({
		fetcher: createGatewayFetch("openrouter", config),
	});
	return {
		apiKey: config.apiKey ?? "unused",
		// Cast needed: the installed @openrouter/sdk version may differ from the
		// version @tanstack/ai-openrouter was built against. The HTTPClient interface
		// is structurally compatible but TypeScript sees them as separate declarations.
		httpClient: httpClient as unknown as OpenRouterConfig["httpClient"],
	};
}

/**
 * Build OpenRouter image config that routes requests through AI Gateway.
 *
 * `OpenRouterImageConfig` extends `OpenRouterClientConfig` which declares
 * `baseURL` and `apiKey` but not `httpClient`. However, the image adapter
 * internally creates an `OpenRouter` SDK instance (which does accept
 * `httpClient` via `SDKOptions`). The double-cast is needed because the
 * declared config type is narrower than what the SDK constructor accepts.
 */
function buildOpenRouterImageConfig(config: OpenRouterGatewayConfig): OpenRouterImageConfig {
	const httpClient = new HTTPClient({
		fetcher: createGatewayFetch("openrouter", config),
	});
	return {
		apiKey: config.apiKey ?? "unused",
		httpClient,
	} as unknown as OpenRouterImageConfig;
}

// ---------------------------------------------------------------------------
// Chat model type — OpenRouter supports many models; we use a loose string type
// ---------------------------------------------------------------------------

/** OpenRouter chat model identifier. Accepts any string since OpenRouter proxies hundreds of models. */
export type OpenRouterChatModel = string;

/** OpenRouter image model identifier. */
export type OpenRouterImageModel = string;

/** OpenRouter summarize model identifier (same as chat models). */
export type OpenRouterSummarizeModel = string;

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Creates an OpenRouter chat adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 *
 * @param model The model to use (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-5")
 * @param config Configuration options
 */
export function createOpenRouterChat(
	model: OpenRouterChatModel,
	config: OpenRouterGatewayConfig,
): AnyTextAdapter {
	// Cast needed: we accept any string model while upstream expects a literal union
	return new OpenRouterTextAdapter(buildOpenRouterConfig(config), model as any);
}

/**
 * Creates an OpenRouter image adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 *
 * @param model The image model to use
 * @param config Configuration options
 */
export function createOpenRouterImage(
	model: OpenRouterImageModel,
	config: OpenRouterGatewayConfig,
) {
	// Cast needed: we accept any string model while upstream expects a literal union
	return new OpenRouterImageAdapter(buildOpenRouterImageConfig(config), model as any);
}

/**
 * Creates an OpenRouter summarize adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 *
 * @param model The model to use for summarization
 * @param config Configuration options
 */
export function createOpenRouterSummarize(
	model: OpenRouterSummarizeModel,
	config: OpenRouterGatewayConfig,
): AnySummarizeAdapter {
	const httpClient = new HTTPClient({
		fetcher: createGatewayFetch("openrouter", config),
	});
	// Cast needed: we accept any string model while upstream expects a literal
	// union, and the installed @openrouter/sdk HTTPClient may differ structurally
	// from the version @tanstack/ai-openrouter was built against.
	return createOpenRouterSummarizeAdapter(model as any, config.apiKey ?? "unused", {
		httpClient: httpClient as any,
	});
}
