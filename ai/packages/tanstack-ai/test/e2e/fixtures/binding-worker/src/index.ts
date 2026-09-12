/**
 * Test worker exercising @cloudflare/tanstack-ai through the env.AI binding.
 *
 * Each endpoint creates a WorkersAiTextAdapter with { binding: env.AI },
 * runs the adapter, and returns the collected AG-UI stream chunks as JSON.
 *
 * This worker is started by wrangler dev during integration tests.
 */
import { createWorkersAiChat, type WorkersAiTextModel } from "../../../../../src/index";
import { WorkersAiTTSAdapter } from "../../../../../src/adapters/workers-ai-tts";
import type { WorkersAiTTSModel } from "../../../../../src/adapters/workers-ai-tts";
import { WorkersAiImageAdapter } from "../../../../../src/adapters/workers-ai-image";
import type { WorkersAiImageModel } from "../../../../../src/adapters/workers-ai-image";
import { WorkersAiTranscriptionAdapter } from "../../../../../src/adapters/workers-ai-transcription";
import type { WorkersAiTranscriptionModel } from "../../../../../src/adapters/workers-ai-transcription";
import { WorkersAiSummarizeAdapter } from "../../../../../src/adapters/workers-ai-summarize";
import { resolveDebugOption } from "@tanstack/ai/adapter-internals";
import { StreamProcessor } from "@tanstack/ai";

const logger = resolveDebugOption(false);

interface Env {
	AI: Ai;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from the adapter's chatStream */
async function collectChunks(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
	const chunks: unknown[] = [];
	for await (const chunk of iterable) {
		chunks.push(chunk);
	}
	return chunks;
}

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Health check
		if (url.pathname === "/health") {
			return jsonResponse({ ok: true });
		}

		if (request.method !== "POST") {
			return jsonResponse({ error: "POST required" }, 405);
		}

		const body = (await request.json()) as {
			model?: string;
			messages?: Array<{ role: string; content: string }>;
		};
		const model = (body.model ||
			"@cf/meta/llama-4-scout-17b-16e-instruct") as WorkersAiTextModel;

		const adapter = createWorkersAiChat(model, { binding: env.AI });

		try {
			switch (url.pathname) {
				// ----- Raw binding stream (for debugging) -----
				case "/debug/raw-stream": {
					const messages = body.messages || [
						{ role: "user", content: "Say hello in exactly one sentence." },
					];
					const result = await (env.AI as any).run(model, {
						messages,
						stream: true,
					});

					if (result instanceof ReadableStream) {
						const reader = (result as ReadableStream<Uint8Array>).getReader();
						const decoder = new TextDecoder();
						let raw = "";
						let done = false;
						while (!done) {
							const { value, done: d } = await reader.read();
							done = d;
							if (value) raw += decoder.decode(value, { stream: true });
						}
						return new Response(raw, {
							headers: { "Content-Type": "text/plain" },
						});
					}
					return jsonResponse({ type: "non-stream", result });
				}
				// ----- Basic chat -----
				case "/chat": {
					const chunks = await collectChunks(
						adapter.chatStream({
							model,
							messages: body.messages || [
								{
									role: "user",
									content: "Say hello in exactly one sentence.",
								},
							],
							temperature: 0,
						} as any),
					);
					return jsonResponse({ chunks });
				}

				// ----- Multi-turn -----
				case "/chat/multi-turn": {
					const chunks = await collectChunks(
						adapter.chatStream({
							model,
							messages: [
								{ role: "user", content: "My name is Alice." },
								{
									role: "assistant",
									content: "Hello Alice! Nice to meet you.",
								},
								{ role: "user", content: "What is my name?" },
							],
							temperature: 0,
						} as any),
					);
					return jsonResponse({ chunks });
				}

				// ----- Tool call (first round only) -----
				case "/chat/tool-call": {
					const chunks = await collectChunks(
						adapter.chatStream({
							model,
							messages: [
								{
									role: "user",
									content:
										"What is 2 + 3? You MUST use the calculator tool to answer.",
								},
							],
							tools: [
								{
									name: "calculator",
									description:
										"Add two numbers. Returns their sum. Always use this tool for math.",
									inputSchema: {
										type: "object",
										properties: {
											a: { type: "number", description: "first number" },
											b: { type: "number", description: "second number" },
										},
										required: ["a", "b"],
									},
								},
							],
							temperature: 0,
						} as any),
					);
					return jsonResponse({ chunks });
				}

				// ----- Tool call run through the real StreamProcessor -----
				// Validates the FULL consumer pipeline: adapter event stream →
				// @tanstack/ai StreamProcessor → UIMessage `tool-call` part.
				// Regression coverage for https://github.com/cloudflare/ai/issues/523
				// where the resulting part was missing its `name`/arguments.
				case "/chat/tool-call-processed": {
					const stream = adapter.chatStream({
						model,
						messages: [
							{
								role: "user",
								content:
									"What is 2 + 3? You MUST use the calculator tool to answer.",
							},
						],
						tools: [
							{
								name: "calculator",
								description:
									"Add two numbers. Returns their sum. Always use this tool for math.",
								inputSchema: {
									type: "object",
									properties: {
										a: { type: "number", description: "first number" },
										b: { type: "number", description: "second number" },
									},
									required: ["a", "b"],
								},
							},
						],
						temperature: 0,
					} as any);

					const processor = new StreamProcessor();
					await processor.process(stream as any);
					const messages = processor.getMessages();
					const toolCallParts = messages
						.flatMap((m: any) => m.parts)
						.filter((p: any) => p.type === "tool-call");

					return jsonResponse({ messages, toolCallParts });
				}

				// ----- Tool round-trip (two calls simulating chat() loop) -----
				case "/chat/tool-roundtrip": {
					// Step 1: model calls tool
					const step1Chunks = await collectChunks(
						adapter.chatStream({
							model,
							messages: [
								{
									role: "user",
									content: "What time is it? Use the get_current_time tool.",
								},
							],
							tools: [
								{
									name: "get_current_time",
									description:
										"Get the current UTC time. Always use this tool when asked about the time.",
									inputSchema: {
										type: "object",
										properties: {},
										required: [],
									},
								},
							],
							temperature: 0,
						} as any),
					);

					// Extract tool call info from step 1
					const toolEnd = step1Chunks.find((c: any) => c.type === "TOOL_CALL_END") as any;

					if (!toolEnd || !toolEnd.toolName) {
						return jsonResponse({
							step1Chunks,
							error: "Step 1: no tool call emitted",
						});
					}

					// Step 2: provide tool result, model responds with text
					const step2Chunks = await collectChunks(
						adapter.chatStream({
							model,
							messages: [
								{
									role: "user",
									content: "What time is it? Use the get_current_time tool.",
								},
								{
									role: "assistant",
									content: "",
									toolCalls: [
										{
											id: toolEnd.toolCallId,
											function: {
												name: toolEnd.toolName,
												arguments: JSON.stringify(toolEnd.input || {}),
											},
										},
									],
								},
								{
									role: "tool",
									toolCallId: toolEnd.toolCallId,
									content: JSON.stringify({
										time: "2026-02-08T15:30:00.000Z",
									}),
								},
							],
							tools: [
								{
									name: "get_current_time",
									description:
										"Get the current UTC time. Always use this tool when asked about the time.",
									inputSchema: {
										type: "object",
										properties: {},
										required: [],
									},
								},
							],
							temperature: 0,
						} as any),
					);

					return jsonResponse({ step1Chunks, step2Chunks });
				}

				// ----- Structured output -----
				case "/chat/structured": {
					const result = await adapter.structuredOutput({
						outputSchema: {
							type: "object",
							properties: {
								name: { type: "string" },
								capital: { type: "string" },
								population: { type: "number" },
							},
							required: ["name", "capital", "population"],
							additionalProperties: false,
						},
						chatOptions: {
							model,
							messages: [
								{
									role: "user",
									content:
										"Give me info about France. Return JSON with name, capital, and population.",
								},
							],
							temperature: 0,
						},
					} as any);
					return jsonResponse({ result });
				}

				// ----- TTS -----
				case "/tts": {
					const ttsBody = body as {
						model?: string;
						text?: string;
						voice?: string;
					};
					const ttsModel = (ttsBody.model || "@cf/deepgram/aura-1") as WorkersAiTTSModel;
					const ttsAdapter = new WorkersAiTTSAdapter({ binding: env.AI }, ttsModel);
					const ttsResult = await ttsAdapter.generateSpeech({
						model: ttsModel,
						text: ttsBody.text || "Hello, this is a test.",
						voice: ttsBody.voice,
						logger,
					});
					return jsonResponse(ttsResult);
				}

				// ----- Image generation -----
				case "/image": {
					const imgBody = body as { model?: string; prompt?: string };
					const imgModel = (imgBody.model ||
						"@cf/stabilityai/stable-diffusion-xl-base-1.0") as WorkersAiImageModel;
					const imgAdapter = new WorkersAiImageAdapter({ binding: env.AI }, imgModel);
					const imgResult = await imgAdapter.generateImages({
						model: imgModel,
						prompt: imgBody.prompt || "a red circle on white background",
						logger,
					});
					// Don't send the full base64 — just metadata + length
					return jsonResponse({
						id: imgResult.id,
						model: imgResult.model,
						imageCount: imgResult.images.length,
						imageSize: imgResult.images[0]?.b64Json?.length ?? 0,
					});
				}

				// ----- Transcription -----
				case "/transcription": {
					const txBody = body as { model?: string; audio?: number[] };
					const txModel = (txBody.model ||
						"@cf/openai/whisper") as WorkersAiTranscriptionModel;
					const txAdapter = new WorkersAiTranscriptionAdapter(
						{ binding: env.AI },
						txModel,
					);
					// Accept audio as number[] from JSON body, or generate silence
					const audioData = txBody.audio || Array.from(new Uint8Array(16000)); // 1s silence
					const txResult = await txAdapter.transcribe({
						model: txModel,
						audio: new Uint8Array(audioData).buffer,
						logger,
					});
					return jsonResponse(txResult);
				}

				// ----- Summarization -----
				case "/summarize": {
					const sumBody = body as { text?: string; model?: string };
					const sumModel = sumBody.model || "@cf/facebook/bart-large-cnn";
					const sumAdapter = new WorkersAiSummarizeAdapter({ binding: env.AI }, sumModel);
					const sumResult = await sumAdapter.summarize({
						model: sumModel,
						text:
							sumBody.text ||
							"Artificial intelligence is the simulation of human intelligence processes by computer systems.",
						logger,
					});
					return jsonResponse(sumResult);
				}

				// ----- Streaming chat (returns chunks as JSON) -----
				case "/chat/stream": {
					const streamBody = body as {
						model?: string;
						messages?: Array<{ role: string; content: string }>;
					};
					const streamModel = (streamBody.model || model) as WorkersAiTextModel;
					const streamAdapter = createWorkersAiChat(streamModel, {
						binding: env.AI,
					});
					const streamChunks = await collectChunks(
						streamAdapter.chatStream({
							model: streamModel,
							messages: streamBody.messages || [
								{ role: "user", content: "Say hello." },
							],
							temperature: 0,
						} as any),
					);
					return jsonResponse({ chunks: streamChunks });
				}

				// ----- Resume-enabled streaming (run path through the gateway) -----
				// Drives the binding's resumable run path (binding.run(model, inputs,
				// { gateway, returnRawResponse })) so a live cf-aig-run-id is surfaced
				// and the resume engine is wired in. When the gateway/run path is
				// unavailable the chat() pipeline surfaces a RUN_ERROR which the test
				// classifies as a skip rather than a failure.
				case "/chat/stream-resume": {
					const rBody = body as { model?: string; gateway?: string };
					const rModel = (rBody.model || "@cf/zai-org/glm-5.2") as WorkersAiTextModel;
					const resumeAdapter = createWorkersAiChat(rModel, {
						binding: env.AI,
						gateway: rBody.gateway || "default",
						resume: true,
						onResumeExpired: "accept-partial",
					});
					const resumeChunks = await collectChunks(
						resumeAdapter.chatStream({
							model: rModel,
							messages: [{ role: "user", content: "Say hello in one sentence." }],
							temperature: 0,
						} as any),
					);
					return jsonResponse({ chunks: resumeChunks });
				}

				default:
					return jsonResponse({ error: `Unknown path: ${url.pathname}` }, 404);
			}
		} catch (err: any) {
			return jsonResponse(
				{
					error: err.message,
					stack: err.stack,
				},
				500,
			);
		}
	},
};
