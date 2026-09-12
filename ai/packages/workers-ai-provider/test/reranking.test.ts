import { APICallError } from "@ai-sdk/provider";
import { rerank } from "ai";
import { describe, expect, it } from "vitest";
import { createWorkersAI } from "../src/index";

// ---------------------------------------------------------------------------
// Basic reranking
// ---------------------------------------------------------------------------

describe("Reranking - Binding", () => {
	it("should rerank text documents", async () => {
		let capturedInputs: any = null;

		const workersai = createWorkersAI({
			binding: {
				run: async (_model: string, inputs: any) => {
					capturedInputs = inputs;
					return {
						response: [
							{ id: 2, score: 0.95 },
							{ id: 0, score: 0.8 },
							{ id: 1, score: 0.3 },
						],
					};
				},
			},
		});

		const result = await rerank({
			model: workersai.reranking("@cf/baai/bge-reranker-base"),
			query: "What is machine learning?",
			documents: [
				"Machine learning is a subset of AI.",
				"The weather is nice today.",
				"Deep learning uses neural networks.",
			],
		});

		// Check ranking — rerank() returns results sorted by score descending
		expect(result.rerankedDocuments).toHaveLength(3);
		// First result should be the highest scoring document (index 2)
		expect(result.rerankedDocuments[0]).toBe("Deep learning uses neural networks.");
		// Verify ranking metadata
		expect(result.ranking).toHaveLength(3);
		expect(result.ranking[0].originalIndex).toBe(2);
		expect(result.ranking[0].score).toBe(0.95);
		expect(result.ranking[1].originalIndex).toBe(0);
		expect(result.ranking[1].score).toBe(0.8);
		expect(result.ranking[2].originalIndex).toBe(1);

		// Check inputs sent to Workers AI
		expect(capturedInputs.query).toBe("What is machine learning?");
		expect(capturedInputs.contexts).toEqual([
			{ text: "Machine learning is a subset of AI." },
			{ text: "The weather is nice today." },
			{ text: "Deep learning uses neural networks." },
		]);
	});

	it("should pass topN as top_k", async () => {
		let capturedInputs: any = null;

		const workersai = createWorkersAI({
			binding: {
				run: async (_model: string, inputs: any) => {
					capturedInputs = inputs;
					return {
						response: [{ id: 0, score: 0.95 }],
					};
				},
			},
		});

		await rerank({
			model: workersai.reranking("@cf/baai/bge-reranker-base"),
			query: "test",
			documents: ["doc1", "doc2", "doc3"],
			topN: 1,
		});

		expect(capturedInputs.top_k).toBe(1);
	});

	it("should handle empty response", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => ({ response: [] }),
			},
		});

		const result = await rerank({
			model: workersai.reranking("@cf/baai/bge-reranker-base"),
			query: "test",
			documents: ["doc1"],
		});

		expect(result.ranking).toHaveLength(0);
		expect(result.rerankedDocuments).toHaveLength(0);
	});

	it("should handle undefined response field", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => ({}),
			},
		});

		const result = await rerank({
			model: workersai.reranking("@cf/baai/bge-reranker-base"),
			query: "test",
			documents: ["doc1"],
		});

		expect(result.ranking).toHaveLength(0);
		expect(result.rerankedDocuments).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

describe("Reranking - Provider", () => {
	it("rerankingModel() is an alias for reranking()", () => {
		const workersai = createWorkersAI({
			binding: { run: async () => ({}) },
		});

		const r1 = workersai.reranking("@cf/baai/bge-reranker-base");
		const r2 = workersai.rerankingModel("@cf/baai/bge-reranker-base");

		expect(r1.modelId).toBe(r2.modelId);
		expect(r1.provider).toBe("workersai.reranking");
	});

	it("should support bge-reranker-v2-m3 model", () => {
		const workersai = createWorkersAI({
			binding: { run: async () => ({}) },
		});

		const model = workersai.reranking("@cf/baai/bge-reranker-v2-m3");
		expect(model.modelId).toBe("@cf/baai/bge-reranker-v2-m3");
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
			.reranking("@cf/baai/bge-reranker-base")
			.doRerank({
				query: "q",
				documents: { type: "text", values: ["a", "b"] },
			})
			.catch((e) => e);

		expect(APICallError.isInstance(err)).toBe(true);
		expect((err as APICallError).statusCode).toBe(429);
		expect((err as APICallError).isRetryable).toBe(true);
	});
});
