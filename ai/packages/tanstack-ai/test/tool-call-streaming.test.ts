/**
 * Integration tests for streamed tool calls.
 *
 * Regression coverage for https://github.com/cloudflare/ai/issues/523 —
 * "Tool calling broken in tanstack-ai package".
 *
 * Unlike `workers-ai-adapter.test.ts` (which mocks `@tanstack/ai`), these tests
 * pipe the WorkersAiTextAdapter's raw AG-UI event stream through the REAL
 * `@tanstack/ai` StreamProcessor and assert on the resulting UIMessage
 * `tool-call` parts. This is the exact pipeline a consuming app uses, so it
 * catches contract mismatches (e.g. a `tool-call` part missing its `name`)
 * that adapter-only assertions cannot.
 *
 * The bug: some Workers AI models stream a tool call's argument fragments
 * BEFORE the function name arrives. The adapter buffered those fragments while
 * waiting for the name (so it could emit a TOOL_CALL_START with the name, which
 * the StreamProcessor reads only once), but then dropped the buffered prefix —
 * forwarding only the post-name fragment. The result was a tool-call part with
 * truncated/empty arguments (and, in older versions, a missing name), so tool
 * dispatch silently failed.
 */
import { describe, expect, it, vi } from "vitest";
import { StreamProcessor } from "@tanstack/ai";
import { WorkersAiTextAdapter } from "../src/adapters/workers-ai";
import type { WorkersAiTextModel } from "../src/adapters/workers-ai";

const MODEL = "@cf/zai-org/glm-4.7-flash" as WorkersAiTextModel;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a binding that streams raw SSE chunks straight through the shim. */
function createSseBinding(chunks: string[]) {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	return {
		run: vi.fn().mockResolvedValue(stream),
		gateway: () => ({ run: () => Promise.resolve(new Response("ok")) }),
	};
}

/** OpenAI-format chat completion chunk (as Workers AI emits for many models). */
function oaiChunk(delta: unknown, finishReason: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "c1",
		object: "chat.completion.chunk",
		created: 0,
		model: "glm",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	})}\n\n`;
}

async function processToUiMessages(adapterStream: AsyncIterable<unknown>) {
	const processor = new StreamProcessor();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter stream is structurally an AsyncIterable<StreamChunk>
	await processor.process(adapterStream as any);
	return processor.getMessages();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- UIMessage parts are dynamically shaped
function toolCallParts(messages: any[]): any[] {
	return messages.flatMap((m) => m.parts).filter((p) => p.type === "tool-call");
}

const TOOLS = [
	{
		name: "search_events",
		description: "Search the calendar",
		inputSchema: {
			type: "object",
			properties: {
				date_from: { type: "string" },
				date_to: { type: "string" },
			},
		},
	},
];

function chatWith(adapter: WorkersAiTextAdapter<WorkersAiTextModel>) {
	return adapter.chatStream({
		model: MODEL,
		messages: [{ role: "user", content: "What's happening today?" }],
		tools: TOOLS,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal options for test
	} as any);
}

// ---------------------------------------------------------------------------
// OpenAI-format streaming (REST / OpenAI-compatible endpoint shape)
// ---------------------------------------------------------------------------

describe("streamed tool calls → real StreamProcessor (OpenAI format)", () => {
	it("name first, args streamed across multiple deltas", async () => {
		const binding = createSseBinding([
			oaiChunk({
				tool_calls: [
					{
						index: 0,
						id: "x",
						type: "function",
						function: { name: "search_events", arguments: "" },
					},
				],
			}),
			oaiChunk({
				tool_calls: [{ index: 0, function: { arguments: '{"date_from": "2026-05-05"' } }],
			}),
			oaiChunk({
				tool_calls: [{ index: 0, function: { arguments: ', "date_to": "2026-05-05"}' } }],
			}),
			oaiChunk({}, "tool_calls"),
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(1);
		expect(parts[0].name).toBe("search_events");
		expect(parts[0].state).toBe("input-complete");
		expect(JSON.parse(parts[0].arguments)).toEqual({
			date_from: "2026-05-05",
			date_to: "2026-05-05",
		});
	});

	it("args streamed BEFORE the name arrives (issue #523)", async () => {
		const binding = createSseBinding([
			// first delta carries args but NO name yet
			oaiChunk({
				tool_calls: [
					{
						index: 0,
						id: "x",
						type: "function",
						function: { arguments: '{"date_from": "2026-05-05"' },
					},
				],
			}),
			// name arrives later, with the remaining args
			oaiChunk({
				tool_calls: [
					{
						index: 0,
						function: {
							name: "search_events",
							arguments: ', "date_to": "2026-05-05"}',
						},
					},
				],
			}),
			oaiChunk({}, "tool_calls"),
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(1);
		// Name must be present — this is the core regression.
		expect(parts[0].name).toBe("search_events");
		// And NO argument fragment may be dropped.
		expect(JSON.parse(parts[0].arguments)).toEqual({
			date_from: "2026-05-05",
			date_to: "2026-05-05",
		});
	});

	it("name and full args delivered in a single delta with finish in same chunk", async () => {
		const binding = createSseBinding([
			oaiChunk(
				{
					tool_calls: [
						{
							index: 0,
							id: "x",
							type: "function",
							function: {
								name: "search_events",
								arguments: '{"date_from": "2026-05-05", "date_to": "2026-05-05"}',
							},
						},
					],
				},
				"tool_calls",
			),
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(1);
		expect(parts[0].name).toBe("search_events");
		expect(JSON.parse(parts[0].arguments)).toEqual({
			date_from: "2026-05-05",
			date_to: "2026-05-05",
		});
	});

	it("parallel tool calls keep distinct names and arguments", async () => {
		const binding = createSseBinding([
			oaiChunk({
				tool_calls: [
					{
						index: 0,
						id: "a",
						type: "function",
						function: { name: "search_events", arguments: "" },
					},
					{
						index: 1,
						id: "b",
						type: "function",
						function: { name: "search_events", arguments: "" },
					},
				],
			}),
			oaiChunk({
				tool_calls: [{ index: 0, function: { arguments: '{"date_from": "2026-05-05"}' } }],
			}),
			oaiChunk({
				tool_calls: [{ index: 1, function: { arguments: '{"date_from": "2026-06-01"}' } }],
			}),
			oaiChunk({}, "tool_calls"),
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(2);
		for (const part of parts) {
			expect(part.name).toBe("search_events");
			expect(part.state).toBe("input-complete");
		}
		expect(JSON.parse(parts[0].arguments)).toEqual({ date_from: "2026-05-05" });
		expect(JSON.parse(parts[1].arguments)).toEqual({ date_from: "2026-06-01" });
		// IDs must be unique so the consumer can match results back.
		expect(parts[0].id).not.toBe(parts[1].id);
	});

	it("stream truncated before finish_reason still yields a usable tool call", async () => {
		const binding = createSseBinding([
			oaiChunk({
				tool_calls: [
					{
						index: 0,
						id: "x",
						type: "function",
						function: {
							name: "search_events",
							arguments: '{"date_from": "2026-05-05"}',
						},
					},
				],
			}),
			// no finish_reason chunk — premature termination
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(1);
		expect(parts[0].name).toBe("search_events");
		expect(parts[0].state).toBe("input-complete");
		expect(JSON.parse(parts[0].arguments)).toEqual({ date_from: "2026-05-05" });
	});
});

// ---------------------------------------------------------------------------
// Native Workers AI streaming format (binding shim path)
// ---------------------------------------------------------------------------

describe("streamed tool calls → real StreamProcessor (native Workers AI format)", () => {
	it("single-chunk native tool call yields full name + args", async () => {
		const binding = createSseBinding([
			'data: {"response":"","tool_calls":[{"name":"search_events","arguments":{"date_from":"2026-05-05","date_to":"2026-05-05"}}]}\n\n',
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(1);
		expect(parts[0].name).toBe("search_events");
		expect(JSON.parse(parts[0].arguments)).toEqual({
			date_from: "2026-05-05",
			date_to: "2026-05-05",
		});
	});

	it("native format streaming name then incremental args", async () => {
		const binding = createSseBinding([
			'data: {"tool_calls":[{"id":"t0","index":0,"function":{"name":"search_events"}}]}\n\n',
			'data: {"tool_calls":[{"index":0,"function":{"arguments":"{\\"date_from\\": \\"2026-05-05\\""}}]}\n\n',
			'data: {"tool_calls":[{"index":0,"function":{"arguments":", \\"date_to\\": \\"2026-05-05\\"}"}}]}\n\n',
		]);
		const parts = toolCallParts(
			await processToUiMessages(chatWith(new WorkersAiTextAdapter(MODEL, { binding }))),
		);

		expect(parts).toHaveLength(1);
		expect(parts[0].name).toBe("search_events");
		expect(JSON.parse(parts[0].arguments)).toEqual({
			date_from: "2026-05-05",
			date_to: "2026-05-05",
		});
	});
});
