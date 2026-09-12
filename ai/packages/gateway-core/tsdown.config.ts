import { defineConfig } from "tsdown";

// `@cloudflare/gateway-core` is private and never published. Consumers inline
// its JavaScript from source (via tsdown `deps.alwaysBundle`), but tsdown cannot
// synthesize declarations from a bundled dep's raw `.ts`, so we emit a built
// `.d.mts` here for consumers to inline via `deps.dts.alwaysBundle`. The JS
// output is emitted too for completeness, but consumers resolve JS from source.
export default defineConfig({
	entry: ["src/index.ts"],
	sourcemap: true,
	clean: true,
	dts: true,
	format: ["esm"],
	target: "es2020",
});
