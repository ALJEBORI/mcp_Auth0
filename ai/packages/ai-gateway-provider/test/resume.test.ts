import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AiGatewayResumeSettings, createAiGateway } from "../src";

const TEST_API_KEY = "test-api-key";
const GATEWAY_ID = "my-gateway";
const RUN_ID = "run-123";

// OpenAI Responses-API SSE events, one complete event per chunk so the resume
// engine can count event boundaries.
const created = `data: {"type": "response.created", "response": {"id": "resp-1", "created_at": 0, "model": "gpt-4o-mini"}}\n\n`;
const added = `data: {"type": "response.output_item.added", "output_index": 0, "item": {"type": "message", "role": "assistant", "id": "msg-1", "content": []}}\n\n`;
const deltaHello = `data: {"type": "response.output_text.delta", "item_id": "msg-1", "delta": "Hello"}\n\n`;
const deltaWorld = `data: {"type": "response.output_text.delta", "item_id": "msg-1", "delta": " world"}\n\n`;
const done = `data: {"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "role": "assistant", "id": "msg-1", "content": [{"type": "output_text", "text": "Hello world", "annotations": []}]}}\n\n`;
const completed = `data: {"type": "response.completed", "response": {"id": "resp-1", "created_at": 0, "model": "gpt-4o-mini", "output": [{"type": "message", "role": "assistant", "id": "msg-1", "content": [{"type": "output_text", "text": "Hello world", "annotations": []}]}], "incomplete_details": null, "object": "response", "usage": {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}}}\n\n`;
const doneSig = "data: [DONE]\n\n";

function streamFrom(chunks: string[], opts: { error?: boolean } = {}): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let i = 0;
	return new ReadableStream({
		pull(controller) {
			if (i < chunks.length) {
				controller.enqueue(encoder.encode(chunks[i++]!));
				return;
			}
			if (opts.error) {
				controller.error(new Error("simulated mid-stream drop"));
				return;
			}
			controller.close();
		},
	});
}

function sseResponse(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "text/event-stream", ...headers },
	});
}

async function collect(textStream: AsyncIterable<string>): Promise<string> {
	let text = "";
	for await (const chunk of textStream) text += chunk;
	return text;
}

describe("Resumable streaming (binding path)", () => {
	afterEach(() => vi.restoreAllMocks());

	it("reconnects on a mid-stream drop and delivers the complete text", async () => {
		const resumeFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
			sseResponse(streamFrom([deltaWorld, done, completed, doneSig])),
		);

		const aigateway = createAiGateway({
			binding: {
				// Initial run drops after emitting "Hello".
				run: async () =>
					sseResponse(streamFrom([created, added, deltaHello], { error: true }), {
						"cf-aig-run-id": RUN_ID,
					}),
			},
			resume: {
				binding: { fetch: resumeFetch } as unknown as AiGatewayResumeSettings["binding"],
				gateway: GATEWAY_ID,
			},
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });

		const result = streamText({
			model: aigateway([openai("gpt-4o-mini")]),
			prompt: "hi",
		});

		expect(await collect(result.textStream)).toBe("Hello world");
		expect(resumeFetch).toHaveBeenCalledTimes(1);
		// Reconnect resumes from the 3 complete events already emitted.
		const resumeUrl = resumeFetch.mock.calls[0]?.[0] as string;
		expect(resumeUrl).toContain(`/run/${RUN_ID}/resume?from=3`);
	});

	it("passes through cleanly when the stream does not drop", async () => {
		const resumeFetch = vi.fn();

		const aigateway = createAiGateway({
			binding: {
				run: async () =>
					sseResponse(
						streamFrom([
							created,
							added,
							deltaHello,
							deltaWorld,
							done,
							completed,
							doneSig,
						]),
						{
							"cf-aig-run-id": RUN_ID,
						},
					),
			},
			resume: {
				binding: { fetch: resumeFetch } as unknown as AiGatewayResumeSettings["binding"],
				gateway: GATEWAY_ID,
			},
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });

		const result = streamText({
			model: aigateway([openai("gpt-4o-mini")]),
			prompt: "hi",
		});

		expect(await collect(result.textStream)).toBe("Hello world");
		expect(resumeFetch).not.toHaveBeenCalled();
	});

	it("is a no-op when the response carries no cf-aig-run-id", async () => {
		const resumeFetch = vi.fn();

		const aigateway = createAiGateway({
			binding: {
				// No cf-aig-run-id header → resume cannot engage.
				run: async () =>
					sseResponse(
						streamFrom([
							created,
							added,
							deltaHello,
							deltaWorld,
							done,
							completed,
							doneSig,
						]),
					),
			},
			resume: {
				binding: { fetch: resumeFetch } as unknown as AiGatewayResumeSettings["binding"],
				gateway: GATEWAY_ID,
			},
		});
		const openai = createOpenAI({ apiKey: TEST_API_KEY });

		const result = streamText({
			model: aigateway([openai("gpt-4o-mini")]),
			prompt: "hi",
		});

		expect(await collect(result.textStream)).toBe("Hello world");
		expect(resumeFetch).not.toHaveBeenCalled();
	});
});
