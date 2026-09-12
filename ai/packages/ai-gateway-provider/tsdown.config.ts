import { defineConfig } from "tsdown";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	entry: ["src/index.ts", "src/providers/*"],
	sourcemap: true,
	clean: true,
	dts: true,
	format: ["cjs", "esm"],
	deps: {
		neverBundle: Object.keys(pkg.optionalDependencies ?? {}).filter(
			(dep) => dep !== "@ai-sdk/google-vertex",
		),
		// `@cloudflare/gateway-core` is a private, source-only workspace package;
		// inline its source rather than treating it as an external dependency.
		alwaysBundle: ["@cloudflare/gateway-core"],
		dts: { alwaysBundle: ["@cloudflare/gateway-core"] },
	},
	target: "es2020",
});
