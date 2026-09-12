import type { OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const createUnified = (arg?: Partial<OpenAICompatibleProviderSettings>) => {
	return createOpenAICompatible({
		baseURL: "https://gateway.ai.cloudflare.com/v1/compat", // intercepted and replaced with actual base URL later
		name: "Unified",
		...(arg || {}),
	});
};

export const unified = createUnified();
