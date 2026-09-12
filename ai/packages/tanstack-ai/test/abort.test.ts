import { resolveDebugOption } from "@tanstack/ai/adapter-internals";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const logger = resolveDebugOption(false);

const ACCOUNT_ID = "test-account-id";
const API_KEY = "test-api-key";
const MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
const RUN_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Abort signal propagation (REST adapters)", () => {
	it("aborts an in-flight Workers AI REST request when the signal fires", async () => {
		server.use(
			http.post(RUN_URL, async () => {
				await delay(2000);
				return HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer);
			}),
		);

		const { WorkersAiImageAdapter } = await import("../src/adapters/workers-ai-image");
		const adapter = new WorkersAiImageAdapter(
			{ accountId: ACCOUNT_ID, apiKey: API_KEY },
			MODEL as never,
		);
		const controller = new AbortController();

		const pending = adapter.generateImages({
			model: MODEL,
			prompt: "a cat",
			modelOptions: { signal: controller.signal },
			logger,
		} as never);

		controller.abort();
		await expect(pending).rejects.toThrow();
	});
});
