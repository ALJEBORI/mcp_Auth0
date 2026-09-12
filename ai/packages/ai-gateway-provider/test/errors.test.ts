import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AiGatewayDoesNotExist, AiGatewayUnauthorizedError, createAiGateway } from "../src";

const TEST_ACCOUNT_ID = "test-account-id";
const TEST_API_KEY = "test-api-key";
const TEST_GATEWAY = "my-gateway";
const GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${TEST_ACCOUNT_ID}/${TEST_GATEWAY}`;

const server = setupServer();

function runGateway() {
	const aigateway = createAiGateway({
		accountId: TEST_ACCOUNT_ID,
		apiKey: TEST_API_KEY,
		gateway: TEST_GATEWAY,
	});
	const openai = createOpenAI({ apiKey: TEST_API_KEY });
	return generateText({
		model: aigateway([openai("gpt-4o-mini")]),
		prompt: "hi",
		maxRetries: 0,
	});
}

describe("Gateway error handling", () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it("throws AiGatewayDoesNotExist on 400 with error code 2001", async () => {
		server.use(
			http.post(GATEWAY_URL, () =>
				HttpResponse.json(
					{ success: false, error: [{ code: 2001, message: "no such gateway" }] },
					{ status: 400 },
				),
			),
		);

		await expect(runGateway()).rejects.toBeInstanceOf(AiGatewayDoesNotExist);
	});

	it("throws AiGatewayUnauthorizedError on 401 with error code 2009", async () => {
		server.use(
			http.post(GATEWAY_URL, () =>
				HttpResponse.json(
					{ success: false, error: [{ code: 2009, message: "unauthorized" }] },
					{ status: 401 },
				),
			),
		);

		await expect(runGateway()).rejects.toBeInstanceOf(AiGatewayUnauthorizedError);
	});

	it("does not throw AiGatewayDoesNotExist for a 400 with an unrelated error code", async () => {
		server.use(
			http.post(GATEWAY_URL, () =>
				HttpResponse.json(
					{ success: false, error: [{ code: 9999, message: "something else" }] },
					{ status: 400 },
				),
			),
		);

		// Still rejects (the model parser sees a 400), but not with our gateway error.
		await expect(runGateway()).rejects.not.toBeInstanceOf(AiGatewayDoesNotExist);
	});

	it("throws when the model list is empty", () => {
		const aigateway = createAiGateway({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
			gateway: TEST_GATEWAY,
		});
		const model = aigateway([]);
		expect(() => model.modelId).toThrow("models cannot be empty array");
		expect(() => model.provider).toThrow("models cannot be empty array");
	});
});
