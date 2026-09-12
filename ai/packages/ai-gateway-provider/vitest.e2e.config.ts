import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		include: ["test/e2e/**/*.e2e.test.ts"],
		// E2E tests hit the live AI Gateway — run sequentially with generous timeouts.
		pool: "forks",
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
