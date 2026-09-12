import { resolveDebugOption } from "@tanstack/ai/adapter-internals";
import { describe, expect, it, vi } from "vitest";

const logger = resolveDebugOption(false);

describe("WorkersAiSummarizeAdapter", () => {
	// -----------------------------------------------------------------------
	// Binding path
	// -----------------------------------------------------------------------

	it("summarize via binding: returns standard SummarizationResult", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const mockBinding = {
			run: vi.fn().mockResolvedValue({ summary: "This is the summary." }),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};

		const adapter = new WorkersAiSummarizeAdapter(
			{ binding: mockBinding },
			"@cf/facebook/bart-large-cnn",
		);

		const result = await adapter.summarize({
			model: "@cf/facebook/bart-large-cnn",
			text: "A very long article about something important...",
			logger,
		});

		expect(result).toHaveProperty("id");
		expect(result.model).toBe("@cf/facebook/bart-large-cnn");
		expect(result.summary).toBe("This is the summary.");
		expect(result.usage).toBeDefined();
		expect(result.usage.promptTokens).toBe(0);
		expect(result.usage.completionTokens).toBe(0);
	});

	it("summarize via binding: passes input_text and max_length", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const mockBinding = {
			run: vi.fn().mockResolvedValue({ summary: "Short summary." }),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};

		const adapter = new WorkersAiSummarizeAdapter(
			{ binding: mockBinding },
			"@cf/facebook/bart-large-cnn",
		);

		await adapter.summarize({
			model: "@cf/facebook/bart-large-cnn",
			text: "Long text here",
			maxLength: 100,
			logger,
		});

		const callArgs = mockBinding.run.mock.calls[0]![1] as Record<string, unknown>;
		expect(callArgs.input_text).toBe("Long text here");
		expect(callArgs.max_length).toBe(100);
	});

	it("summarize via binding: handles missing summary field", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const mockBinding = {
			run: vi.fn().mockResolvedValue({}),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};

		const adapter = new WorkersAiSummarizeAdapter(
			{ binding: mockBinding },
			"@cf/facebook/bart-large-cnn",
		);

		const result = await adapter.summarize({
			model: "@cf/facebook/bart-large-cnn",
			text: "Some text",
			logger,
		});

		// Falls back to empty string when summary is missing
		expect(result.summary).toBe("");
	});

	it("summarize via binding: omits max_length when not specified", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const mockBinding = {
			run: vi.fn().mockResolvedValue({ summary: "result" }),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};

		const adapter = new WorkersAiSummarizeAdapter(
			{ binding: mockBinding },
			"@cf/facebook/bart-large-cnn",
		);

		await adapter.summarize({
			model: "@cf/facebook/bart-large-cnn",
			text: "Some text",
			logger,
		});

		const callArgs = mockBinding.run.mock.calls[0]![1] as Record<string, unknown>;
		expect(callArgs.input_text).toBe("Some text");
		expect(callArgs).not.toHaveProperty("max_length");
	});

	it("normalizes an out-of-capacity (3040) binding error to a retryable 429 error", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");
		const mockBinding = {
			run: vi.fn().mockRejectedValue(new Error("3040: Capacity temporarily exceeded")),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiSummarizeAdapter(
			{ binding: mockBinding, maxRetries: 0 } as any,
			"@cf/facebook/bart-large-cnn",
		);

		await expect(
			adapter.summarize({ model: "@cf/facebook/bart-large-cnn", text: "x", logger }),
		).rejects.toMatchObject({ name: "WorkersAiRequestError", status: 429 });
	});

	// -----------------------------------------------------------------------
	// REST path
	// -----------------------------------------------------------------------

	it("summarize via REST: returns summary on success", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ result: { summary: "REST summary" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		) as any;

		try {
			const adapter = new WorkersAiSummarizeAdapter(
				{ accountId: "abc", apiKey: "key" },
				"@cf/facebook/bart-large-cnn",
			);

			const result = await adapter.summarize({
				model: "@cf/facebook/bart-large-cnn",
				text: "Long article here...",
				logger,
			});

			expect(result.summary).toBe("REST summary");
			expect(result.model).toBe("@cf/facebook/bart-large-cnn");

			// Verify correct URL and headers
			const call = (globalThis.fetch as any).mock.calls[0]!;
			expect(call[0]).toContain("/ai/run/@cf/facebook/bart-large-cnn");
			expect(call[1].headers.Authorization).toBe("Bearer key");

			// Verify body sent correctly
			const body = JSON.parse(call[1].body);
			expect(body.input_text).toBe("Long article here...");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("summarize via REST: throws on non-ok response", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response("Bad Request", { status: 400 })) as any;

		try {
			const adapter = new WorkersAiSummarizeAdapter(
				{ accountId: "abc", apiKey: "key" },
				"@cf/facebook/bart-large-cnn",
			);

			await expect(
				adapter.summarize({
					model: "@cf/facebook/bart-large-cnn",
					text: "Some text",
					logger,
				}),
			).rejects.toThrow(/Workers AI summarize request failed \(400\)/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	// -----------------------------------------------------------------------
	// Gateway path
	// -----------------------------------------------------------------------

	it("summarize via gateway: returns summary on success", async () => {
		const mockGatewayFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ result: { summary: "Gateway summary" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		vi.resetModules();
		vi.doMock("../src/utils/create-fetcher", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../src/utils/create-fetcher")>();
			return { ...actual, createGatewayFetch: () => mockGatewayFetch };
		});

		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");
		const adapter = new WorkersAiSummarizeAdapter(
			{ accountId: "abc", gatewayId: "gw", cfApiKey: "tok" },
			"@cf/facebook/bart-large-cnn",
		);

		const result = await adapter.summarize({
			model: "@cf/facebook/bart-large-cnn",
			text: "Long article...",
			logger,
		});

		expect(result.summary).toBe("Gateway summary");
		expect(mockGatewayFetch).toHaveBeenCalledOnce();

		// Verify gateway URL
		const call = mockGatewayFetch.mock.calls[0]!;
		expect(call[0]).toContain("/ai/summarization");

		vi.doUnmock("../src/utils/create-fetcher");
	});

	it("summarize via gateway: handles top-level summary in response", async () => {
		// Some gateway responses may have { summary: "..." } instead of { result: { summary: "..." } }
		const mockGatewayFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ summary: "Top-level summary" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		vi.resetModules();
		vi.doMock("../src/utils/create-fetcher", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../src/utils/create-fetcher")>();
			return { ...actual, createGatewayFetch: () => mockGatewayFetch };
		});

		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");
		const adapter = new WorkersAiSummarizeAdapter(
			{ accountId: "abc", gatewayId: "gw", cfApiKey: "tok" },
			"@cf/facebook/bart-large-cnn",
		);

		const result = await adapter.summarize({
			model: "@cf/facebook/bart-large-cnn",
			text: "Some text",
			logger,
		});

		expect(result.summary).toBe("Top-level summary");

		vi.doUnmock("../src/utils/create-fetcher");
	});

	it("summarize via gateway: throws on non-ok response", async () => {
		// 502 is retryable, so return a fresh Response per attempt (a single
		// Response instance can only have its body read once).
		const mockGatewayFetch = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(new Response("Gateway error", { status: 502 })),
			);

		vi.resetModules();
		vi.doMock("../src/utils/create-fetcher", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../src/utils/create-fetcher")>();
			return { ...actual, createGatewayFetch: () => mockGatewayFetch };
		});

		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");
		const adapter = new WorkersAiSummarizeAdapter(
			{ accountId: "abc", gatewayId: "gw", cfApiKey: "tok" },
			"@cf/facebook/bart-large-cnn",
		);

		await expect(
			adapter.summarize({
				model: "@cf/facebook/bart-large-cnn",
				text: "Some text",
				logger,
			}),
		).rejects.toThrow(/Workers AI summarize gateway request failed \(502\)/);

		vi.doUnmock("../src/utils/create-fetcher");
	});

	// -----------------------------------------------------------------------
	// Properties + factory
	// -----------------------------------------------------------------------

	it("adapter has kind = 'summarize'", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");

		const adapter = new WorkersAiSummarizeAdapter(
			{ accountId: "abc", apiKey: "key" },
			"@cf/facebook/bart-large-cnn",
		);

		expect(adapter.kind).toBe("summarize");
		expect(adapter.name).toBe("workers-ai-summarize");
		expect(adapter.model).toBe("@cf/facebook/bart-large-cnn");
	});

	it("createWorkersAiSummarize factory creates correct adapter", async () => {
		const { createWorkersAiSummarize } = await import("../src/adapters/workers-ai-summarize");

		const adapter = createWorkersAiSummarize("@cf/facebook/bart-large-cnn", {
			accountId: "abc",
			apiKey: "key",
		});

		expect(adapter.kind).toBe("summarize");
		expect(adapter.model).toBe("@cf/facebook/bart-large-cnn");
	});

	// -----------------------------------------------------------------------
	// Config validation
	// -----------------------------------------------------------------------

	it("throws for empty config (no binding, no credentials)", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");
		expect(
			() => new WorkersAiSummarizeAdapter({} as any, "@cf/facebook/bart-large-cnn"),
		).toThrow(/Invalid Workers AI configuration/);
	});

	it("accepts an arbitrary model string", async () => {
		const { WorkersAiSummarizeAdapter } = await import("../src/adapters/workers-ai-summarize");
		const mockBinding = {
			run: vi.fn().mockResolvedValue({ summary: "ok" }),
			gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
		};
		const adapter = new WorkersAiSummarizeAdapter(
			{ binding: mockBinding },
			"@cf/my-org/custom-summarizer",
		);
		expect(adapter).toBeDefined();
	});
});
