export interface ModelOption {
	id: string;
	label: string;
}

export const chatModels: ModelOption[] = [
	{ id: "@cf/zai-org/glm-5.2", label: "GLM 5.2" },
	{ id: "@cf/nvidia/nemotron-3-120b-a12b", label: "Nemotron 3 120B" },
	{ id: "@cf/moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code" },
	{ id: "@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash" },
	{ id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
	{ id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B" },
	{ id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B" },
	{ id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B" },
	{ id: "@cf/openai/gpt-oss-20b", label: "GPT-OSS 20B" },
];

export const imageModels: ModelOption[] = [
	{ id: "@cf/black-forest-labs/flux-2-dev", label: "Flux 2 Dev" },
	{ id: "@cf/black-forest-labs/flux-1-schnell", label: "Flux 1 Schnell" },
	{ id: "@cf/leonardo/lucid-origin", label: "Leonardo Lucid Origin" },
	{ id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", label: "Stable Diffusion XL" },
	{ id: "@cf/lykon/dreamshaper-8-lcm", label: "Dreamshaper 8" },
];

export const embeddingModels: ModelOption[] = [
	{ id: "@cf/baai/bge-m3", label: "BGE M3 (multilingual)" },
	{ id: "@cf/qwen/qwen3-embedding-0.6b", label: "Qwen3 Embedding 0.6B" },
	{ id: "@cf/google/embeddinggemma-300m", label: "EmbeddingGemma 300M (multilingual)" },
	{ id: "@cf/baai/bge-large-en-v1.5", label: "BGE Large EN (1024d)" },
	{ id: "@cf/baai/bge-base-en-v1.5", label: "BGE Base EN (768d)" },
	{ id: "@cf/baai/bge-small-en-v1.5", label: "BGE Small EN (384d)" },
];

export const transcriptionModels: ModelOption[] = [
	{ id: "@cf/deepgram/flux", label: "Deepgram Flux" },
	{ id: "@cf/openai/whisper-large-v3-turbo", label: "Whisper Large v3 Turbo" },
	{ id: "@cf/deepgram/nova-3", label: "Deepgram Nova-3" },
	{ id: "@cf/openai/whisper", label: "Whisper" },
	{ id: "@cf/openai/whisper-tiny-en", label: "Whisper Tiny EN" },
];

export const ttsModels: ModelOption[] = [
	{ id: "@cf/deepgram/aura-2-en", label: "Deepgram Aura-2 EN" },
	{ id: "@cf/deepgram/aura-2-es", label: "Deepgram Aura-2 ES" },
	{ id: "@cf/deepgram/aura-1", label: "Deepgram Aura-1" },
	{ id: "@cf/myshell-ai/melotts", label: "MeloTTS" },
];

export const rerankingModels: ModelOption[] = [
	{ id: "@cf/baai/bge-reranker-base", label: "BGE Reranker Base" },
];
