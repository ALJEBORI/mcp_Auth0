import {
	GrokTextAdapter,
	GrokImageAdapter,
	createGrokSummarize as createGrokSummarizeAdapter,
	GROK_CHAT_MODELS,
	GROK_IMAGE_MODELS,
	type GrokChatModel,
	type GrokImageModel,
	type GrokSummarizeModel,
} from "@tanstack/ai-grok";
import { createGatewayFetch, type AiGatewayAdapterConfig } from "../utils/create-fetcher";
import type { AnySummarizeAdapter } from "@tanstack/ai";

export type GrokGatewayConfig = AiGatewayAdapterConfig;

/**
 * Creates a Grok chat adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 *
 * Since GrokTextConfig extends the OpenAI SDK's ClientOptions,
 * we can inject the gateway fetch directly — no subclassing needed.
 */
export function createGrokChat(
	model: GrokChatModel,
	config: GrokGatewayConfig,
): GrokTextAdapter<GrokChatModel> {
	return new GrokTextAdapter(
		{
			apiKey: config.apiKey ?? "unused",
			fetch: createGatewayFetch("grok", config),
		},
		model,
	);
}

/**
 * Creates a Grok image adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 */
export function createGrokImage(model: GrokImageModel, config: GrokGatewayConfig) {
	return new GrokImageAdapter(
		{
			apiKey: config.apiKey ?? "unused",
			fetch: createGatewayFetch("grok", config),
		},
		model,
	);
}

/**
 * Creates a Grok summarize adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 */
export function createGrokSummarize(
	model: GrokSummarizeModel,
	config: GrokGatewayConfig,
): AnySummarizeAdapter {
	return createGrokSummarizeAdapter(model, config.apiKey ?? "unused", {
		fetch: createGatewayFetch("grok", config),
	});
}

export {
	GROK_CHAT_MODELS,
	GROK_IMAGE_MODELS,
	type GrokChatModel,
	type GrokImageModel,
	type GrokSummarizeModel,
};
