import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/adapters/anthropic.ts",
		"src/adapters/gemini.ts",
		"src/adapters/grok.ts",
		"src/adapters/openai.ts",
		"src/adapters/openrouter.ts",
		"src/adapters/workers-ai.ts",
		"src/adapters/workers-ai-image.ts",
		"src/adapters/workers-ai-transcription.ts",
		"src/adapters/workers-ai-tts.ts",
		"src/adapters/workers-ai-summarize.ts",
	],
	sourcemap: true,
	clean: true,
	dts: true,
	format: ["cjs", "esm"],
	// Production deps (openai, @tanstack/ai*, the optional SDKs) stay external by
	// default; `@cloudflare/gateway-core` is a private, source-only workspace
	// package, so inline its source rather than treating it as external.
	deps: {
		// Keep node_modules external (matching the prior `skipNodeModulesBundle`
		// behavior for the types we import directly), but inline the private
		// source-only `@cloudflare/gateway-core` into both JS and dts.
		neverBundle: ["@cloudflare/workers-types"],
		alwaysBundle: ["@cloudflare/gateway-core"],
		dts: {
			neverBundle: ["@cloudflare/workers-types"],
			alwaysBundle: ["@cloudflare/gateway-core"],
		},
	},
	target: "es2020",
});
