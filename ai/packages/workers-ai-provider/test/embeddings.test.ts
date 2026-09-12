import { APICallError } from "@ai-sdk/provider";
import { embed, embedMany } from "ai";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { describe, expect, it } from "vitest";
import { createWorkersAI } from "../src/index";

const TEST_ACCOUNT_ID = "test-account-id";
const TEST_API_KEY = "test-api-key";
const TEST_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

const embedResponse = [[0, 1, 2, 3]];
const embedHandler = http.post(
	`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_EMBEDDING_MODEL}`,
	async () => {
		return HttpResponse.json({
			result: {
				data: embedResponse,
			},
		});
	},
);

const embedManyResponse = [
	[0, 1, 2, 3],
	[4, 5, 6, 7],
	[8, 9, 10, 11],
	[12, 13, 14, 15],
];
const embedManyHandler = http.post(
	`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_EMBEDDING_MODEL}`,
	async () => {
		return HttpResponse.json({
			result: {
				data: embedManyResponse,
			},
		});
	},
);

describe("REST API - Embedding Tests", () => {
	it("should embed a single value", async () => {
		const server = setupServer(embedHandler);
		server.listen();
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});
		const result = await embed({
			model: workersai.embedding(TEST_EMBEDDING_MODEL),
			value: "Remember when you were young, you shone like the sun",
		});
		expect(result.embedding).toEqual(embedResponse[0]);
		server.close();
	});

	it("should embed multiple values", async () => {
		const server = setupServer(embedManyHandler);
		server.listen();
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});
		const result = await embedMany({
			model: workersai.embedding(TEST_EMBEDDING_MODEL),
			values: [
				"Remember when you were young, you shone like the sun",
				"Now there's a look in your eyes, like black holes in the sky",
				"You reached for the secret too soon, you cried for the moon",
				"Threatened by shadows at night, and exposed in the light",
			],
		});
		expect(result.embeddings).toEqual(embedManyResponse);
		server.close();
	});
});

describe("Binding - Embedding Tests", () => {
	it("should embed a single value", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return {
						data: embedResponse,
					};
				},
			},
		});
		const result = await embed({
			model: workersai.embedding(TEST_EMBEDDING_MODEL),
			value: "Remember when you were young, you shone like the sun",
		});
		expect(result.embedding).toEqual([0, 1, 2, 3]);
	});

	it("should embed multiple values", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return {
						data: embedManyResponse,
					};
				},
			},
		});
		const result = await embedMany({
			model: workersai.embedding(TEST_EMBEDDING_MODEL),
			values: [
				"Remember when you were young, you shone like the sun",
				"Now there's a look in your eyes, like black holes in the sky",
				"You reached for the secret too soon, you cried for the moon",
				"Threatened by shadows at night, and exposed in the light",
			],
		});
		expect(result.embeddings).toEqual(embedManyResponse);
	});

	it("should throw TooManyEmbeddingValuesForCallError when exceeding limit", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return { data: [] };
				},
			},
		});

		const model = workersai.embedding(TEST_EMBEDDING_MODEL);

		// The model's doEmbed method checks maxEmbeddingsPerCall (default 3000)
		// We need to call doEmbed directly to test this since embedMany handles batching
		await expect(
			model.doEmbed({
				values: Array.from({ length: 3001 }, (_, i) => `text ${i}`),
			}),
		).rejects.toThrow("Too many values");
	});

	it("should respect custom maxEmbeddingsPerCall setting", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return { data: [] };
				},
			},
		});

		const model = workersai.embedding(TEST_EMBEDDING_MODEL, {
			maxEmbeddingsPerCall: 2,
		});

		await expect(
			model.doEmbed({
				values: ["one", "two", "three"],
			}),
		).rejects.toThrow("Too many values");
	});

	it("normalizes an out-of-capacity binding error to a retryable 429 APICallError", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					throw new Error("3040: Capacity temporarily exceeded, please try again.");
				},
			} as any,
		});

		const err = await workersai
			.embedding(TEST_EMBEDDING_MODEL)
			.doEmbed({ values: ["x"] })
			.catch((e) => e);

		expect(APICallError.isInstance(err)).toBe(true);
		expect((err as APICallError).statusCode).toBe(429);
		expect((err as APICallError).isRetryable).toBe(true);
	});
});
