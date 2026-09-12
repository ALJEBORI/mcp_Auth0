import { describe, expect, it, vi } from "vitest";
import { authWrapper, CF_TEMP_TOKEN } from "../src/auth";

describe("authWrapper", () => {
	it("injects the CF_TEMP_TOKEN when called with no config", () => {
		const inner = vi.fn((config) => config);
		const wrapped = authWrapper(inner);

		wrapped(undefined);

		expect(inner).toHaveBeenCalledWith({ apiKey: CF_TEMP_TOKEN });
	});

	it("injects the CF_TEMP_TOKEN when config has no apiKey", () => {
		const inner = vi.fn((config) => config);
		const wrapped = authWrapper(inner);

		const result = wrapped({ baseURL: "https://example.com" } as never);

		expect(result).toMatchObject({
			baseURL: "https://example.com",
			apiKey: CF_TEMP_TOKEN,
		});
	});

	it("preserves a user-provided apiKey", () => {
		const inner = vi.fn((config) => config);
		const wrapped = authWrapper(inner);

		const result = wrapped({ apiKey: "sk-real-key" });

		expect(result).toEqual({ apiKey: "sk-real-key" });
		expect(inner).toHaveBeenCalledWith({ apiKey: "sk-real-key" });
	});
});
