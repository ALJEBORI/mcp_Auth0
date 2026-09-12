import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAiGateway } from "../src";

const TEST_ACCOUNT_ID = "test-account-id";
const TEST_API_KEY = "test-api-key";
const TEST_GATEWAY = "my-gateway";
const GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${TEST_ACCOUNT_ID}/${TEST_GATEWAY}`;

function openAiResponse(text: string) {
	return {
		id: "resp-test",
		created_at: Math.floor(Date.now() / 1000),
		model: "gpt-4o-mini",
		output: [
			{
				type: "message",
				role: "assistant",
				id: "msg-1",
				content: [{ type: "output_text", text, annotations: [] }],
			},
		],
		incomplete_details: null,
		object: "response",
		usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
	};
}

let captured: { body: unknown } = { body: null };
const server = setupServer();

describe("Cross-vendor fallback", () => {
	beforeAll(() => server.listen());
	afterEach(() => {
		server.resetHandlers();
		captured = { body: null };
	});
	afterAll(() => server.close());

	it("sends every fallback model as an ordered gateway entry", async () => {
		server.use(
			http.post(GATEWAY_URL, async ({ request }) => {
				captured.body = await request.json();
				return HttpResponse.json(openAiResponse("ok"), {
					headers: { "cf-aig-step": "0" },
				});
			}),
		);

		const aigateway = createAiGateway({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
			gateway: TEST_GATEWAY,
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });
		const anthropic = createAnthropic({ apiKey: TEST_API_KEY });

		await generateText({
			model: aigateway([openai("gpt-4o-mini"), anthropic("claude-sonnet-4-5")]),
			prompt: "hi",
			maxRetries: 0,
		});

		const body = captured.body as Array<{ provider: string }>;
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(2);
		expect(body[0]?.provider).toBe("openai");
		expect(body[1]?.provider).toBe("anthropic");
	});

	it("parses the response with the model chosen by cf-aig-step", async () => {
		// step:1 → the SECOND model wins. With the second model being OpenAI and
		// the response in OpenAI format, a correct selection yields the text; a
		// wrong selection (the Anthropic first model) would fail to parse it.
		server.use(
			http.post(GATEWAY_URL, async () =>
				HttpResponse.json(openAiResponse("Hello from step 1"), {
					headers: { "cf-aig-step": "1" },
				}),
			),
		);

		const aigateway = createAiGateway({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
			gateway: TEST_GATEWAY,
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });
		const anthropic = createAnthropic({ apiKey: TEST_API_KEY });

		const result = await generateText({
			model: aigateway([anthropic("claude-sonnet-4-5"), openai("gpt-4o-mini")]),
			prompt: "hi",
			maxRetries: 0,
		});

		expect(result.text).toBe("Hello from step 1");
	});

	it("defaults to step 0 when no cf-aig-step header is present", async () => {
		server.use(
			http.post(GATEWAY_URL, async () =>
				HttpResponse.json(openAiResponse("Hello from step 0")),
			),
		);

		const aigateway = createAiGateway({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
			gateway: TEST_GATEWAY,
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });
		const anthropic = createAnthropic({ apiKey: TEST_API_KEY });

		const result = await generateText({
			model: aigateway([openai("gpt-4o-mini"), anthropic("claude-sonnet-4-5")]),
			prompt: "hi",
			maxRetries: 0,
		});

		expect(result.text).toBe("Hello from step 0");
	});
});
