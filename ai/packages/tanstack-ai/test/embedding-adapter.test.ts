import { describe, expect, it, vi } from "vitest";
import { WorkersAiRequestError } from "../src/utils/errors";

// ---------------------------------------------------------------------------
// WorkersAiEmbeddingAdapter
// ---------------------------------------------------------------------------

describe("WorkersAiEmbeddingAdapter", () => {
	it("embedViaBinding: calls binding.run with { text: [...] }", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const mockBinding = {
			run: vi.fn().mockResolvedValue({ shape: [2, 768], data: [[0.1], [0.2]] }),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			{ binding: mockBinding },
			"@cf/baai/bge-base-en-v1.5" as any,
		);

		const result = await adapter.embed(["hello", "world"]);

		expect(mockBinding.run).toHaveBeenCalledOnce();
		const [model, inputs] = mockBinding.run.mock.calls[0]!;
		expect(model).toBe("@cf/baai/bge-base-en-v1.5");
		expect(inputs).toEqual({ text: ["hello", "world"] });
		expect(result.embeddings).toEqual([[0.1], [0.2]]);
	});

	it("embedViaGateway: sends { text: [...] } not { input: [...] }", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const mockGatewayBinding = {
			run: vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						shape: [2, 768],
						data: [[0.1], [0.2]],
					}),
				),
			),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			{ binding: mockGatewayBinding },
			"@cf/baai/bge-base-en-v1.5" as any,
		);

		const result = await adapter.embed(["hello", "world"]);

		expect(mockGatewayBinding.run).toHaveBeenCalledOnce();
		const request = mockGatewayBinding.run.mock.calls[0]![0];
		// The gateway request should use Workers AI native field name "text", not "input"
		expect(request.query.text).toEqual(["hello", "world"]);
		expect(request.query.input).toBeUndefined();
		expect(result.embeddings).toEqual([[0.1], [0.2]]);
	});

	// -----------------------------------------------------------------------
	// Error normalization + retry
	// -----------------------------------------------------------------------

	it("normalizes an out-of-capacity (3040) binding error to a 429 WorkersAiRequestError", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const mockBinding = {
			run: vi.fn().mockRejectedValue(new Error("3040: Capacity temporarily exceeded")),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			// maxRetries: 0 keeps the test instant — we only assert normalization here.
			{ binding: mockBinding, maxRetries: 0 } as any,
			"@cf/baai/bge-base-en-v1.5" as any,
		);

		await expect(adapter.embed(["hi"])).rejects.toMatchObject({
			name: "WorkersAiRequestError",
			status: 429,
		});
	});

	it("retries a transient (3040) binding failure and then succeeds", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("3040: out of capacity"))
			.mockResolvedValue({ shape: [1, 1], data: [[0.5]] });
		const mockBinding = {
			run,
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			{ binding: mockBinding } as any,
			"@cf/baai/bge-base-en-v1.5" as any,
		);

		const result = await adapter.embed(["hi"]);
		expect(run).toHaveBeenCalledTimes(2);
		expect(result.embeddings).toEqual([[0.5]]);
	});

	it("does not retry a non-retryable (5007) binding error", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const run = vi.fn().mockRejectedValue(new Error("5007: No such model"));
		const mockBinding = {
			run,
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			{ binding: mockBinding } as any,
			"@cf/baai/bge-base-en-v1.5" as any,
		);

		await expect(adapter.embed(["hi"])).rejects.toBeInstanceOf(WorkersAiRequestError);
		expect(run).toHaveBeenCalledOnce();
	});

	it("embedViaGateway: throws a structured error on a non-ok gateway response", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const mockGatewayBinding = {
			run: vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			{ binding: mockGatewayBinding, maxRetries: 0 } as any,
			"@cf/baai/bge-base-en-v1.5" as any,
		);

		await expect(adapter.embed(["hi"])).rejects.toMatchObject({
			name: "WorkersAiRequestError",
			status: 429,
		});
	});

	it("embedViaRest: throws on non-ok response", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response("Unauthorized", { status: 401 })) as any;

		try {
			const adapter = new WorkersAiEmbeddingAdapter(
				{ accountId: "abc", apiKey: "bad-key" },
				"@cf/baai/bge-base-en-v1.5" as any,
			);

			await expect(adapter.embed(["hello"])).rejects.toThrow(
				/Workers AI embedding request failed \(401\)/,
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	// -----------------------------------------------------------------------
	// Config validation
	// -----------------------------------------------------------------------

	it("throws for empty config (no binding, no credentials)", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		expect(
			() => new WorkersAiEmbeddingAdapter({} as any, "@cf/baai/bge-base-en-v1.5" as any),
		).toThrow(/Invalid Workers AI configuration/);
	});

	it("accepts an arbitrary model string", async () => {
		const { WorkersAiEmbeddingAdapter } = await import("../src/adapters/workers-ai-embedding");
		const mockBinding = {
			run: vi.fn().mockResolvedValue({ shape: [1, 768], data: [[0.1]] }),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiEmbeddingAdapter(
			{ binding: mockBinding },
			"@cf/my-org/custom-embedding-model",
		);
		expect(adapter).toBeDefined();
	});
});
