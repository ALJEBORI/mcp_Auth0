/**
 * Provider definitions and their capabilities.
 * This is the single source of truth for what appears in the UI.
 */

export type Capability = "chat" | "image" | "summarize" | "transcription" | "tts";

export interface ProviderDef {
	id: string;
	label: string;
	color: string; // Tailwind gradient colors for the icon
	description: string;
	capabilities: Capability[];
	/** Models shown in the chat model selector (Workers AI only) */
	chatModels?: { id: string; label: string }[];
}

const WORKERS_AI_CHAT_MODELS = [
	{ id: "@cf/zai-org/glm-5.2", label: "GLM 5.2" },
	{ id: "@cf/nvidia/nemotron-3-120b-a12b", label: "Nemotron 3 120B" },
	{ id: "@cf/moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code" },
	{ id: "@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash" },
	{ id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
	{ id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B" },
	{ id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B" },
	{ id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B" },
	{ id: "@cf/openai/gpt-oss-20b", label: "GPT-OSS 20B" },
	{ id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1" },
];

export const PROVIDERS: ProviderDef[] = [
	{
		id: "workers-ai-plain",
		label: "Workers AI",
		color: "from-orange-400 to-orange-600",
		description: "Direct env.AI binding — no gateway needed, works out of the box.",
		capabilities: ["chat", "image", "transcription", "tts", "summarize"],
		chatModels: WORKERS_AI_CHAT_MODELS,
	},
	{
		id: "workers-ai",
		label: "Workers AI (Gateway)",
		color: "from-amber-500 to-yellow-600",
		description:
			"Workers AI routed through AI Gateway for caching, logging, and rate limiting.",
		capabilities: ["chat", "image", "transcription", "tts", "summarize"],
		chatModels: WORKERS_AI_CHAT_MODELS,
	},
	{
		id: "openai",
		label: "OpenAI",
		color: "from-green-500 to-emerald-600",
		description: "GPT-5.2, DALL-E, Whisper, and TTS via Cloudflare AI Gateway.",
		capabilities: ["chat", "image", "transcription", "tts", "summarize"],
	},
	{
		id: "anthropic",
		label: "Anthropic",
		color: "from-amber-500 to-orange-600",
		description: "Claude Opus 4.6 via Cloudflare AI Gateway.",
		capabilities: ["chat", "summarize"],
	},
	{
		id: "gemini",
		label: "Gemini",
		color: "from-blue-500 to-indigo-600",
		description: "Google's Gemini models for chat, image, TTS, and summarization.",
		capabilities: ["chat", "image", "tts", "summarize"],
	},
	{
		id: "grok",
		label: "Grok",
		color: "from-purple-500 to-violet-600",
		description: "xAI's Grok models via Cloudflare AI Gateway.",
		capabilities: ["chat", "image", "summarize"],
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		color: "from-pink-500 to-rose-600",
		description: "Access hundreds of models through OpenRouter via AI Gateway.",
		capabilities: ["chat", "image", "summarize"],
	},
];

export const CAPABILITY_LABELS: Record<Capability, { label: string; icon: string }> = {
	chat: {
		label: "Chat",
		icon: "M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
	},
	image: {
		label: "Image",
		icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z",
	},
	summarize: {
		label: "Summarize",
		icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
	},
	transcription: {
		label: "Transcription",
		icon: "M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z",
	},
	tts: {
		label: "Text-to-Speech",
		icon: "M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z",
	},
};
