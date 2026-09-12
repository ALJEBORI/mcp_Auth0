import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/gateway-provider.ts",
		"src/openai.ts",
		"src/anthropic.ts",
		"src/google.ts",
	],
	sourcemap: true,
	clean: true,
	dts: true,
	format: ["esm"],
	target: "es2020",
	// `@cloudflare/gateway-core` is a private, source-only workspace package.
	// Inline its source into this bundle (and dts) rather than treating it as an
	// external runtime dependency.
	deps: {
		alwaysBundle: ["@cloudflare/gateway-core"],
		dts: { alwaysBundle: ["@cloudflare/gateway-core"] },
	},
});
