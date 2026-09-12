import {
	createOpenaiSummarize,
	OpenAIImageAdapter,
	OpenAITextAdapter,
	OpenAITranscriptionAdapter,
	OpenAITTSAdapter,
	OpenAIVideoAdapter,
	OPENAI_CHAT_MODELS,
	OPENAI_IMAGE_MODELS,
	OPENAI_TRANSCRIPTION_MODELS,
	OPENAI_TTS_MODELS,
	OPENAI_VIDEO_MODELS,
	type OpenAIChatModel,
	type OpenAIImageModel,
	type OpenAITranscriptionModel,
	type OpenAITTSModel,
	type OpenAIVideoModel,
} from "@tanstack/ai-openai";
import { createGatewayFetch, type AiGatewayAdapterConfig } from "../utils/create-fetcher";
import type { AnySummarizeAdapter } from "@tanstack/ai";

export type OpenAiGatewayConfig = AiGatewayAdapterConfig;

/**
 * Builds an OpenAI-compatible config that injects the gateway fetch.
 * OpenAITextConfig extends OpenAI SDK's ClientOptions, which supports a `fetch` parameter.
 */
function buildOpenAiConfig(provider: string, config: OpenAiGatewayConfig) {
	return {
		apiKey: config.apiKey ?? "unused",
		fetch: createGatewayFetch(provider, config),
	};
}

/**
 * Creates an OpenAI chat adapter which uses Cloudflare AI Gateway.
 * Supports both binding and credential-based configurations.
 * @param model The OpenAI model to use
 * @param config Configuration options
 */
export function createOpenAiChat(
	model: OpenAIChatModel,
	config: OpenAiGatewayConfig,
): OpenAITextAdapter<OpenAIChatModel> {
	return new OpenAITextAdapter(buildOpenAiConfig("openai", config), model);
}

/**
 * Creates an OpenAI summarize adapter which uses Cloudflare AI Gateway.
 * @param model The OpenAI model to use
 * @param config Configuration options
 */
export function createOpenAiSummarize(
	model: OpenAIChatModel,
	config: OpenAiGatewayConfig,
): AnySummarizeAdapter {
	return createOpenaiSummarize(model, config.apiKey ?? "unused", {
		fetch: createGatewayFetch("openai", config),
	});
}

/**
 * Creates an OpenAI image adapter which uses Cloudflare AI Gateway.
 * @param model The OpenAI image model to use
 * @param config Configuration options
 */
export function createOpenAiImage(model: OpenAIImageModel, config: OpenAiGatewayConfig) {
	return new OpenAIImageAdapter(buildOpenAiConfig("openai", config), model);
}

/**
 * Creates an OpenAI transcription adapter which uses Cloudflare AI Gateway.
 * @param model The OpenAI transcription model to use
 * @param config Configuration options
 */
export function createOpenAiTranscription(
	model: OpenAITranscriptionModel,
	config: OpenAiGatewayConfig,
) {
	return new OpenAITranscriptionAdapter(buildOpenAiConfig("openai", config), model);
}

/**
 * Creates an OpenAI TTS adapter which uses Cloudflare AI Gateway.
 * @param model The OpenAI TTS model to use
 * @param config Configuration options
 */
export function createOpenAiTts(model: OpenAITTSModel, config: OpenAiGatewayConfig) {
	return new OpenAITTSAdapter(buildOpenAiConfig("openai", config), model);
}

/**
 * Creates an OpenAI video adapter which uses Cloudflare AI Gateway.
 * @param model The OpenAI video model to use
 * @param config Configuration options
 */
export function createOpenAiVideo(model: OpenAIVideoModel, config: OpenAiGatewayConfig) {
	return new OpenAIVideoAdapter(buildOpenAiConfig("openai", config), model);
}

export {
	OPENAI_CHAT_MODELS,
	OPENAI_IMAGE_MODELS,
	OPENAI_TRANSCRIPTION_MODELS,
	OPENAI_TTS_MODELS,
	OPENAI_VIDEO_MODELS,
	type OpenAIChatModel,
	type OpenAIImageModel,
	type OpenAITranscriptionModel,
	type OpenAITTSModel,
	type OpenAIVideoModel,
};
