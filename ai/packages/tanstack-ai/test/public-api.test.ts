import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Public API exports
// Mock unavailable optional dependencies so importing index.ts doesn't fail.
// These mocks are intentionally scoped to this file only.
// ---------------------------------------------------------------------------

vi.mock("@tanstack/ai/adapters", () => {
	class MockAdapter {
		kind: string;
		model: string;
		config: object;
		constructor(config: object, model: string) {
			this.kind = "";
			this.config = config;
			this.model = model;
		}
		generateId() {
			return "test-id";
		}
	}
	return {
		BaseTextAdapter: class extends MockAdapter {
			constructor(c: any, m: any) {
				super(c, m);
				this.kind = "text";
			}
		},
		BaseImageAdapter: class extends MockAdapter {
			constructor(c: any, m: any) {
				super(c, m);
				this.kind = "image";
			}
		},
		BaseTranscriptionAdapter: class extends MockAdapter {
			constructor(c: any, m: any) {
				super(c, m);
				this.kind = "transcription";
			}
		},
		BaseTTSAdapter: class extends MockAdapter {
			constructor(c: any, m: any) {
				super(c, m);
				this.kind = "tts";
			}
		},
		BaseSummarizeAdapter: class extends MockAdapter {
			constructor(c: any, m: any) {
				super(c, m);
				this.kind = "summarize";
			}
		},
	};
});
vi.mock("@tanstack/ai", () => ({
	// Type-only imports don't need values, but we include empty stubs for safety
}));
vi.mock("@tanstack/ai-openai", () => ({
	OpenAITextAdapter: class {},
	OpenAISummarizeAdapter: class {},
	OpenAIImageAdapter: class {},
	OpenAITranscriptionAdapter: class {},
	OpenAITTSAdapter: class {},
	OpenAIVideoAdapter: class {},
	OPENAI_CHAT_MODELS: ["gpt-4o"],
	OPENAI_IMAGE_MODELS: ["dall-e-3"],
	OPENAI_TRANSCRIPTION_MODELS: ["whisper-1"],
	OPENAI_TTS_MODELS: ["tts-1"],
	OPENAI_VIDEO_MODELS: ["sora"],
}));
vi.mock("@tanstack/ai-anthropic", () => ({
	AnthropicTextAdapter: class {},
	AnthropicSummarizeAdapter: class {},
	ANTHROPIC_MODELS: ["claude-sonnet-4-5"],
}));
vi.mock("@tanstack/ai-gemini", () => ({
	GeminiTextAdapter: class {},
	GeminiSummarizeAdapter: class {},
	GeminiImageAdapter: class {},
	GeminiTTSAdapter: class {},
	GeminiTextModels: ["gemini-2.5-flash"],
	GeminiImageModels: ["imagen-4.0-generate-001"],
	GeminiSummarizeModels: ["gemini-2.0-flash"],
	GeminiTTSModels: ["gemini-2.5-flash-preview-tts"],
}));
vi.mock("@tanstack/ai-grok", () => ({
	GrokTextAdapter: class {},
	GrokImageAdapter: class {},
	GrokSummarizeAdapter: class {},
	GROK_CHAT_MODELS: ["grok-3"],
	GROK_IMAGE_MODELS: ["grok-2-image-1212"],
}));
vi.mock("@tanstack/ai-openrouter", () => ({
	OpenRouterTextAdapter: class {},
	OpenRouterImageAdapter: class {},
	OpenRouterSummarizeAdapter: class {},
}));
vi.mock("@openrouter/sdk", () => ({
	HTTPClient: class {
		constructor() {}
	},
}));
vi.mock("openai", () => ({ default: class {} }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {} }));

describe("public API exports", () => {
	it("should export factory functions from index", async () => {
		const exports = await import("../src/index");

		// Workers AI factory functions
		expect(typeof exports.createWorkersAiChat).toBe("function");
		expect(typeof exports.createWorkersAiImage).toBe("function");
		expect(typeof exports.createWorkersAiTranscription).toBe("function");
		expect(typeof exports.createWorkersAiTts).toBe("function");
		expect(typeof exports.createWorkersAiSummarize).toBe("function");

		// Embedding adapter is held back until TanStack AI adds BaseEmbeddingAdapter
		expect((exports as any).createWorkersAiEmbedding).toBeUndefined();

		// Third-party factory functions
		expect(typeof exports.createOpenAiChat).toBe("function");
		expect(typeof exports.createAnthropicChat).toBe("function");
		expect(typeof exports.createGeminiChat).toBe("function");
		expect(typeof exports.createGeminiTts).toBe("function");
		expect(typeof exports.createGrokChat).toBe("function");
		expect(typeof exports.createGrokSummarize).toBe("function");

		// OpenRouter factory functions
		expect(typeof exports.createOpenRouterChat).toBe("function");
		expect(typeof exports.createOpenRouterImage).toBe("function");
		expect(typeof exports.createOpenRouterSummarize).toBe("function");
	});

	it("should export config types (verified via factory functions)", async () => {
		const exports = await import("../src/index");

		// These types are verified by TypeScript at compile time;
		// at runtime we just ensure the module loaded cleanly.
		expect(exports).toBeDefined();
	});

	it("should NOT export internal config detection helpers", async () => {
		const exports = await import("../src/index");

		// These are internal implementation details
		expect((exports as any).isDirectBindingConfig).toBeUndefined();
		expect((exports as any).isDirectCredentialsConfig).toBeUndefined();
		expect((exports as any).isGatewayConfig).toBeUndefined();
		expect((exports as any).createWorkersAiBindingFetch).toBeUndefined();
		expect((exports as any).createGatewayFetch).toBeUndefined();
	});

	it("should export upstream model constants", async () => {
		const exports = await import("../src/index");

		// Anthropic
		expect(exports.ANTHROPIC_MODELS).toBeDefined();

		// OpenAI
		expect(exports.OPENAI_CHAT_MODELS).toBeDefined();
		expect(exports.OPENAI_IMAGE_MODELS).toBeDefined();

		// Gemini
		expect(exports.GeminiTextModels).toBeDefined();
		expect(exports.GeminiImageModels).toBeDefined();
		expect(exports.GeminiTTSModels).toBeDefined();

		// Grok
		expect(exports.GROK_CHAT_MODELS).toBeDefined();
		expect(exports.GROK_IMAGE_MODELS).toBeDefined();
	});

	it("should NOT export internal Gemini adapter classes", async () => {
		const exports = await import("../src/index");

		expect((exports as any).GeminiTextGatewayAdapter).toBeUndefined();
		expect((exports as any).GeminiImageGatewayAdapter).toBeUndefined();
		expect((exports as any).GeminiSummarizeGatewayAdapter).toBeUndefined();
	});
});
