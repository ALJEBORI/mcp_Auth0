import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/e2e/**/*.e2e.test.ts"],
		// E2E tests hit real APIs — run sequentially and with generous timeouts
		pool: "forks",
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
