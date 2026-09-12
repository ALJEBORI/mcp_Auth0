import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAiGateway } from "../src";

const TEST_ACCOUNT_ID = "test-account-id";
const TEST_API_KEY = "test-api-key";
const TEST_GATEWAY = "my-gateway";
const GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${TEST_ACCOUNT_ID}/${TEST_GATEWAY}`;

const server = setupServer();

describe("Abort signal propagation", () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it("aborts an in-flight REST request when the signal fires", async () => {
		server.use(
			http.post(GATEWAY_URL, async () => {
				await delay(2000);
				return HttpResponse.json({ ok: true });
			}),
		);

		const aigateway = createAiGateway({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
			gateway: TEST_GATEWAY,
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });
		const controller = new AbortController();

		const pending = generateText({
			model: aigateway([openai("gpt-4o-mini")]),
			prompt: "hi",
			abortSignal: controller.signal,
			maxRetries: 0,
		});

		controller.abort();
		await expect(pending).rejects.toThrow();
	});

	it("threads the signal into binding.run so the run can abort", async () => {
		const aigateway = createAiGateway({
			binding: {
				run: (_data, options) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = options?.signal;
						if (signal?.aborted) {
							reject(new DOMException("Aborted", "AbortError"));
							return;
						}
						signal?.addEventListener("abort", () =>
							reject(new DOMException("Aborted", "AbortError")),
						);
					}),
			},
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });
		const controller = new AbortController();

		const pending = generateText({
			model: aigateway([openai("gpt-4o-mini")]),
			prompt: "hi",
			abortSignal: controller.signal,
			maxRetries: 0,
		});

		controller.abort();
		await expect(pending).rejects.toThrow();
	});
});
