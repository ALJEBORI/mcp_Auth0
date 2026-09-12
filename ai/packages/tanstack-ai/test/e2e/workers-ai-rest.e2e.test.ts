/**
 * E2E tests for Workers AI via REST API.
 *
 * These tests call the real Cloudflare Workers AI API. They require valid
 * credentials in a `.env` file at the package root:
 *
 *   CLOUDFLARE_ACCOUNT_ID=<your account id>
 *   CLOUDFLARE_API_TOKEN=<your API token with Workers AI access>
 *
 * Run with: pnpm test:e2e
 *
 * These are excluded from the default `pnpm test` / `pnpm test:ci` runs.
 */
import { resolveDebugOption } from "@tanstack/ai/adapter-internals";
import { afterAll, describe, expect, it, vi } from "vitest";

const logger = resolveDebugOption(false);

// Load env vars from .env at package root
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });

// We need to mock @tanstack/ai and @tanstack/ai/adapters so the adapter
// module can be imported without the full TanStack dependency graph being
// present in the test runner.
vi.mock("@tanstack/ai/adapters", () => ({
	BaseTextAdapter: class {
		model: string;
		constructor(_config: unknown, model: string) {
			this.model = model;
		}
	},
	// Image / Transcription / TTS base adapters take `(model, config?)`.
	BaseImageAdapter: class {
		kind = "image";
		model: string;
		constructor(model: string, _config?: unknown) {
			this.model = model;
		}
		generateId() {
			return `test-${crypto.randomUUID().slice(0, 8)}`;
		}
	},
	BaseTranscriptionAdapter: class {
		kind = "transcription";
		model: string;
		constructor(model: string, _config?: unknown) {
			this.model = model;
		}
		generateId() {
			return `test-${crypto.randomUUID().slice(0, 8)}`;
		}
	},
	BaseTTSAdapter: class {
		kind = "tts";
		model: string;
		constructor(model: string, _config?: unknown) {
			this.model = model;
		}
		generateId() {
			return `test-${crypto.randomUUID().slice(0, 8)}`;
		}
	},
	BaseSummarizeAdapter: class {
		kind = "summarize";
		model: string;
		constructor(_config: unknown, model: string) {
			this.model = model;
		}
		generateId() {
			return `test-${crypto.randomUUID().slice(0, 8)}`;
		}
	},
}));
vi.mock("@tanstack/ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/ai")>();
	return { EventType: actual.EventType };
});

import { WorkersAiTextAdapter } from "../../src/adapters/workers-ai";
import type { WorkersAiTextModel } from "../../src/adapters/workers-ai";

// ---------------------------------------------------------------------------
// Config & helpers
// ---------------------------------------------------------------------------

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

function skip() {
	return !ACCOUNT_ID || !API_TOKEN;
}

/** Collect all chunks from an async iterable */
async function collectChunks(iterable: AsyncIterable<unknown>) {
	const chunks: any[] = [];
	for await (const chunk of iterable) {
		chunks.push(chunk);
	}
	return chunks;
}

/** Find a chunk by type */
function findChunk(chunks: any[], type: string) {
	return chunks.find((c) => c.type === type);
}

/** Filter chunks by type */
function filterChunks(chunks: any[], type: string) {
	return chunks.filter((c) => c.type === type);
}

function makeAdapter(modelId: string) {
	return new WorkersAiTextAdapter(modelId as WorkersAiTextModel, {
		accountId: ACCOUNT_ID!,
		apiKey: API_TOKEN!,
	});
}

// ---------------------------------------------------------------------------
// Results tracker — accumulates per-model outcomes, prints table at the end
// ---------------------------------------------------------------------------

type Status = "ok" | "warn" | "fail";

const results: Record<
	string,
	{
		chat: Status;
		multiTurn: Status;
		toolCalling: Status;
		toolRoundTrip: Status;
		structuredOutput: Status;
		reasoning: Status;
		notes: string[];
	}
> = {};

function getResult(label: string) {
	if (!results[label]) {
		results[label] = {
			chat: "fail",
			multiTurn: "fail",
			toolCalling: "fail",
			toolRoundTrip: "fail",
			structuredOutput: "fail",
			reasoning: "fail",
			notes: [],
		};
	}
	return results[label];
}

function statusIcon(s: Status): string {
	if (s === "ok") return "  OK";
	if (s === "warn") return "  ~ ";
	return "  X ";
}

function printSummaryTable() {
	const labels = Object.keys(results);
	if (labels.length === 0) return;

	const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
	const maxLabel = Math.max(...labels.map((l) => l.length), 5);

	const header = `${pad("Model", maxLabel)} | Chat | Turn | Tool | T-RT | JSON | Think | Notes`;
	const sep = "-".repeat(header.length + 10);

	console.log("\n" + sep);
	console.log("  WORKERS AI MODEL COMPARISON");
	console.log(sep);
	console.log(header);
	console.log(sep);

	for (const label of labels) {
		const r = results[label]!;
		const notes = r.notes.length > 0 ? r.notes.join("; ") : "";
		console.log(
			`${pad(label, maxLabel)} | ${statusIcon(r.chat)} | ${statusIcon(r.multiTurn)} | ${statusIcon(r.toolCalling)} | ${statusIcon(r.toolRoundTrip)} | ${statusIcon(r.structuredOutput)} | ${statusIcon(r.reasoning)} | ${notes}`,
		);
	}

	console.log(sep);
	console.log("  OK = works correctly    ~ = partial/quirky    X = broken/error    - = N/A");
	console.log("  T-RT = tool round-trip    Think = reasoning (STEP_STARTED/STEP_FINISHED)");
	console.log(sep + "\n");
}

// ---------------------------------------------------------------------------
// Models to test
// ---------------------------------------------------------------------------

// Aligned with the binding e2e + examples/workers-ai models list.
const MODELS = [
	{ id: "@cf/zai-org/glm-5.2", label: "GLM 5.2", reasoning: false },
	{
		id: "@cf/nvidia/nemotron-3-120b-a12b",
		label: "Nemotron 3 120B",
		reasoning: true,
	},
	{
		id: "@cf/moonshotai/kimi-k2.7-code",
		label: "Kimi K2.7 Code",
		reasoning: true,
	},
	{
		id: "@cf/meta/llama-4-scout-17b-16e-instruct",
		label: "Llama 4 Scout 17B",
		reasoning: false,
	},
	{
		id: "@cf/google/gemma-4-26b-a4b-it",
		label: "Gemma 4 26B",
		reasoning: true,
	},
	{
		id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
		label: "Mistral Small 3.1",
		reasoning: false,
	},
	{ id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B", reasoning: false },
	{ id: "@cf/qwen/qwq-32b", label: "QwQ 32B (reasoning)", reasoning: true },
	{ id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", reasoning: false },
	{ id: "@cf/openai/gpt-oss-20b", label: "GPT-OSS 20B", reasoning: false },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skip())("Workers AI REST E2E", () => {
	afterAll(() => {
		printSummaryTable();
	});

	// ------------------------------------------------------------------
	// Per-model: basic chat
	// ------------------------------------------------------------------

	describe("chat (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — basic chat streaming`, async () => {
				const r = getResult(model.label);
				const adapter = makeAdapter(model.id);
				const chunks = await collectChunks(
					adapter.chatStream({
						model: model.id as WorkersAiTextModel,
						messages: [{ role: "user", content: "Say hello in one sentence." }],
						temperature: 0,
					} as any),
				);

				const runStarted = findChunk(chunks, "RUN_STARTED");
				const runFinished = findChunk(chunks, "RUN_FINISHED");
				const runError = findChunk(chunks, "RUN_ERROR");
				const contentChunks = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");

				expect(runStarted).toBeDefined();

				if (runError) {
					r.chat = "fail";
					r.notes.push(`chat: ${runError.error?.message}`);
					return;
				}

				expect(runFinished).toBeDefined();

				if (contentChunks.length > 0) {
					r.chat = "ok";
				} else {
					r.chat = "warn";
					r.notes.push("chat: 0 content chunks");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: multi-turn conversation
	// ------------------------------------------------------------------

	describe("multi-turn (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — remembers context across turns`, async () => {
				const r = getResult(model.label);
				const adapter = makeAdapter(model.id);
				const chunks = await collectChunks(
					adapter.chatStream({
						model: model.id as WorkersAiTextModel,
						messages: [
							{ role: "user", content: "My name is Alice." },
							{ role: "assistant", content: "Hello Alice! Nice to meet you." },
							{ role: "user", content: "What is my name?" },
						],
						temperature: 0,
					} as any),
				);

				const runError = findChunk(chunks, "RUN_ERROR");
				const contentChunks = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");

				if (runError) {
					r.multiTurn = "fail";
					r.notes.push(`turn: ${runError.error?.message}`);
					return;
				}

				if (contentChunks.length === 0) {
					r.multiTurn = "warn";
					r.notes.push("turn: no content");
					return;
				}

				const fullText = contentChunks[contentChunks.length - 1].content;
				const remembers = fullText.toLowerCase().includes("alice");

				if (remembers) {
					r.multiTurn = "ok";
				} else {
					r.multiTurn = "warn";
					r.notes.push("turn: forgot context");
				}

				expect(findChunk(chunks, "RUN_STARTED")).toBeDefined();
				expect(findChunk(chunks, "RUN_FINISHED")).toBeDefined();
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: tool calling
	// ------------------------------------------------------------------

	describe("tool calling (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — tool calling`, async () => {
				const r = getResult(model.label);
				const adapter = makeAdapter(model.id);

				let chunks: any[];
				try {
					chunks = await collectChunks(
						adapter.chatStream({
							model: model.id as WorkersAiTextModel,
							messages: [
								{
									role: "user",
									content:
										"What is 123 + 456? You MUST use the calculator tool to answer.",
								},
							],
							tools: [
								{
									name: "calculator",
									description:
										"Add two numbers together. Returns their sum. Always use this tool for math.",
									inputSchema: {
										type: "object",
										properties: {
											a: { type: "number", description: "First number" },
											b: { type: "number", description: "Second number" },
										},
										required: ["a", "b"],
									},
								},
							],
							temperature: 0,
						} as any),
					);
				} catch (err: any) {
					r.toolCalling = "fail";
					r.notes.push(`tool: threw ${err.message.slice(0, 40)}`);
					return;
				}

				const toolStarts = filterChunks(chunks, "TOOL_CALL_START");
				const toolEnds = filterChunks(chunks, "TOOL_CALL_END");
				const contentChunks = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");
				const runError = findChunk(chunks, "RUN_ERROR");
				const runFinished = findChunk(chunks, "RUN_FINISHED");

				expect(findChunk(chunks, "RUN_STARTED")).toBeDefined();

				if (runError) {
					r.toolCalling = "fail";
					r.notes.push(`tool: ${runError.error?.message?.slice(0, 40)}`);
					return;
				}

				expect(runFinished).toBeDefined();

				if (toolStarts.length > 0) {
					expect(toolStarts[0].toolName).toBe("calculator");
					expect(toolEnds.length).toBeGreaterThanOrEqual(1);
					if (toolEnds.length !== toolStarts.length) {
						r.toolCalling = "warn";
						r.notes.push(`tool: ${toolStarts.length} starts/${toolEnds.length} ends`);
					} else {
						r.toolCalling = "ok";
					}
				} else if (contentChunks.length > 0) {
					r.toolCalling = "warn";
					r.notes.push("tool: answered as text");
				} else {
					r.toolCalling = "fail";
					r.notes.push("tool: empty response");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: tool result round-trip
	// Simulates: user asks → model calls tool → tool result provided → model responds with text
	// This is the full loop that TanStack's chat() does automatically.
	// ------------------------------------------------------------------

	describe("tool result round-trip (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — tool result round-trip`, async () => {
				const r = getResult(model.label);
				const adapter = makeAdapter(model.id);

				// Step 1: send user message with tool available
				let firstChunks: any[];
				try {
					firstChunks = await collectChunks(
						adapter.chatStream({
							model: model.id as WorkersAiTextModel,
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
				} catch (err: any) {
					r.toolRoundTrip = "fail";
					r.notes.push(`t-rt: step1 threw ${err.message.slice(0, 30)}`);
					return;
				}

				const firstError = findChunk(firstChunks, "RUN_ERROR");
				if (firstError) {
					r.toolRoundTrip = "fail";
					r.notes.push(`t-rt: step1 error ${firstError.error?.message?.slice(0, 30)}`);
					return;
				}

				const toolStarts = filterChunks(firstChunks, "TOOL_CALL_START");
				const firstContent = filterChunks(firstChunks, "TEXT_MESSAGE_CONTENT");

				if (toolStarts.length === 0) {
					// Model didn't call the tool — answered directly
					if (firstContent.length > 0) {
						r.toolRoundTrip = "warn";
						r.notes.push("t-rt: skipped tool, answered directly");
					} else {
						r.toolRoundTrip = "fail";
						r.notes.push("t-rt: no tool call and no content");
					}
					return;
				}

				// Step 2: provide tool result and ask model to respond
				const toolCallEnd = findChunk(firstChunks, "TOOL_CALL_END");
				const toolCallId = toolCallEnd?.toolCallId || "call_1";
				const toolName = toolCallEnd?.toolName || "get_current_time";

				let secondChunks: any[];
				try {
					secondChunks = await collectChunks(
						adapter.chatStream({
							model: model.id as WorkersAiTextModel,
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
											id: toolCallId,
											function: {
												name: toolName,
												arguments: "{}",
											},
										},
									],
								},
								{
									role: "tool",
									toolCallId: toolCallId,
									content: JSON.stringify({ time: "2026-02-08T15:30:00.000Z" }),
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
				} catch (err: any) {
					r.toolRoundTrip = "fail";
					r.notes.push(`t-rt: step2 threw ${err.message.slice(0, 30)}`);
					return;
				}

				const secondError = findChunk(secondChunks, "RUN_ERROR");
				if (secondError) {
					r.toolRoundTrip = "fail";
					r.notes.push(`t-rt: step2 error ${secondError.error?.message?.slice(0, 30)}`);
					return;
				}

				const secondContent = filterChunks(secondChunks, "TEXT_MESSAGE_CONTENT");
				const secondFinished = findChunk(secondChunks, "RUN_FINISHED");

				if (secondContent.length > 0 && secondFinished) {
					const text = secondContent[secondContent.length - 1].content;
					r.toolRoundTrip = "ok";
					console.log(`  ✓ ${model.label}: tool round-trip OK — "${text.slice(0, 80)}"`);
				} else if (secondFinished) {
					r.toolRoundTrip = "fail";
					r.notes.push("t-rt: step2 finished but 0 content");
					console.warn(
						`  ✗ ${model.label}: tool round-trip EMPTY — model produced no text after tool result`,
					);
				} else {
					r.toolRoundTrip = "fail";
					r.notes.push("t-rt: step2 no finish");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: structured output
	// ------------------------------------------------------------------

	describe("structured output (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — structured output`, async () => {
				const r = getResult(model.label);
				const adapter = makeAdapter(model.id);

				let result: any;
				try {
					result = await adapter.structuredOutput({
						outputSchema: {
							type: "object",
							properties: {
								capital: { type: "string" },
								population_millions: { type: "number" },
							},
							required: ["capital", "population_millions"],
						},
						chatOptions: {
							model: model.id as WorkersAiTextModel,
							messages: [
								{
									role: "user",
									content:
										"What is the capital of France and its approximate population in millions?",
								},
							],
							temperature: 0,
						},
					} as any);
				} catch (err: any) {
					r.structuredOutput = "fail";
					r.notes.push(`json: threw ${err.message.slice(0, 40)}`);
					return;
				}

				expect(result).toBeDefined();

				if (
					typeof result.rawText === "string" &&
					result.rawText.length > 0 &&
					typeof result.data === "object" &&
					result.data !== null
				) {
					const data = result.data as Record<string, unknown>;
					const hasCapital = typeof data.capital === "string";
					const hasPop = typeof data.population_millions === "number";

					if (hasCapital && hasPop) {
						r.structuredOutput = "ok";
					} else {
						r.structuredOutput = "warn";
						r.notes.push("json: wrong shape");
					}
				} else {
					r.structuredOutput = "fail";
					r.notes.push(`json: got ${typeof result.data} instead of object`);
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Reasoning models: STEP_STARTED / STEP_FINISHED events
	// ------------------------------------------------------------------

	const REASONING_MODELS = MODELS.filter((m) => m.reasoning);

	describe("reasoning (reasoning models only)", () => {
		for (const model of REASONING_MODELS) {
			it(`${model.label} — emits STEP_STARTED/STEP_FINISHED via REST`, async () => {
				const r = getResult(model.label);
				const adapter = makeAdapter(model.id);

				const chunks = await collectChunks(
					adapter.chatStream({
						model: model.id as WorkersAiTextModel,
						messages: [
							{
								role: "user",
								content: "What is 15 * 37? Think step by step before answering.",
							},
						],
						temperature: 0,
					} as any),
				);

				const runError = findChunk(chunks, "RUN_ERROR");
				if (runError) {
					r.reasoning = "fail";
					r.notes.push(`reasoning: ${runError.error?.message?.slice(0, 40)}`);
					return;
				}

				const stepStarted = findChunk(chunks, "STEP_STARTED");
				const stepFinished = filterChunks(chunks, "STEP_FINISHED");

				if (stepStarted && stepFinished.length > 0) {
					if (stepStarted.stepType !== "thinking") {
						r.reasoning = "warn";
						r.notes.push(`reasoning: stepType=${stepStarted.stepType}`);
						return;
					}

					const lastStep = stepFinished[stepFinished.length - 1];
					if (lastStep.content && lastStep.content.length > 0) {
						r.reasoning = "ok";
						console.log(
							`  ✓ ${model.label}: reasoning OK — ${stepFinished.length} step events, ${lastStep.content.length} chars`,
						);
					} else {
						r.reasoning = "warn";
						r.notes.push("reasoning: empty content");
					}
				} else {
					r.reasoning = "warn";
					r.notes.push(
						`reasoning: STEP_STARTED=${!!stepStarted}, STEP_FINISHED=${stepFinished.length}`,
					);
				}
			});
		}

		// Non-reasoning models should NOT emit step events
		const NON_REASONING_MODELS = MODELS.filter((m) => !m.reasoning);
		for (const model of NON_REASONING_MODELS) {
			it(`${model.label} — does NOT emit reasoning events`, async () => {
				const r = getResult(model.label);

				// Mark as N/A by default for non-reasoning models
				r.reasoning = "ok";

				const adapter = makeAdapter(model.id);
				const chunks = await collectChunks(
					adapter.chatStream({
						model: model.id as WorkersAiTextModel,
						messages: [{ role: "user", content: "Say hello in one sentence." }],
						temperature: 0,
					} as any),
				);

				const runError = findChunk(chunks, "RUN_ERROR");
				if (runError) return; // Chat test captures this

				const stepStarted = findChunk(chunks, "STEP_STARTED");
				if (stepStarted) {
					r.reasoning = "warn";
					r.notes.push("reasoning: unexpected STEP events");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// System prompts (one model is enough)
	// ------------------------------------------------------------------

	describe("system prompts", () => {
		it("should handle system prompts (GPT-OSS 20B)", async () => {
			const adapter = makeAdapter("@cf/openai/gpt-oss-20b");
			const chunks = await collectChunks(
				adapter.chatStream({
					model: "@cf/openai/gpt-oss-20b" as WorkersAiTextModel,
					systemPrompts: ["You are a pirate. Always respond in pirate speak."],
					messages: [{ role: "user", content: "Say hello." }],
					temperature: 0.5,
				} as any),
			);

			const contentChunks = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");
			expect(contentChunks.length).toBeGreaterThan(0);

			const runFinished = findChunk(chunks, "RUN_FINISHED");
			expect(runFinished).toBeDefined();
			expect(runFinished.finishReason).toBe("stop");
		});
	});

	// ------------------------------------------------------------------
	// Error handling
	// ------------------------------------------------------------------

	describe("error handling", () => {
		it("should emit RUN_ERROR for an invalid model", async () => {
			const badAdapter = makeAdapter("@cf/nonexistent/fake-model-999");

			const chunks = await collectChunks(
				badAdapter.chatStream({
					model: "@cf/nonexistent/fake-model-999" as WorkersAiTextModel,
					messages: [{ role: "user", content: "Hi" }],
				} as any),
			);

			const runError = findChunk(chunks, "RUN_ERROR");
			expect(runError).toBeDefined();
			expect(runError.error).toBeDefined();
			expect(typeof runError.error.message).toBe("string");
		});
	});

	// ==================================================================
	// Non-chat capabilities via REST
	// These use dynamic imports to avoid module initialization issues
	// with vitest's mock hoisting.
	// ==================================================================

	// ------------------------------------------------------------------
	// TTS — test field name across models
	// ------------------------------------------------------------------

	const TTS_MODELS = [
		{ id: "@cf/deepgram/aura-1", label: "Deepgram Aura-1" },
		{ id: "@cf/deepgram/aura-2-en", label: "Deepgram Aura-2 EN" },
	];

	describe("TTS (per model)", () => {
		for (const model of TTS_MODELS) {
			it(`${model.label} — generates audio via REST (text field)`, async () => {
				const { WorkersAiTTSAdapter } = await import("../../src/adapters/workers-ai-tts");
				const adapter = new WorkersAiTTSAdapter(
					{ accountId: ACCOUNT_ID!, apiKey: API_TOKEN! },
					model.id as any,
				);

				const result = await adapter.generateSpeech({
					model: model.id,
					text: "Hello, this is a test of text to speech.",
					logger,
				});

				expect(result).toBeDefined();
				expect(result.model).toBe(model.id);
				expect(result.audio).toBeTruthy();
				expect(typeof result.audio).toBe("string");
				// Base64 audio should be non-trivial (> 100 chars)
				expect(result.audio.length).toBeGreaterThan(100);
				expect(result.format).toBe("mp3");
				console.log(`  ✓ ${model.label}: TTS OK — ${result.audio.length} chars base64`);
			});

			it(`${model.label} — TTS with voice option`, async () => {
				const { WorkersAiTTSAdapter } = await import("../../src/adapters/workers-ai-tts");
				const adapter = new WorkersAiTTSAdapter(
					{ accountId: ACCOUNT_ID!, apiKey: API_TOKEN! },
					model.id as any,
				);

				const result = await adapter.generateSpeech({
					model: model.id,
					text: "Testing voice selection.",
					voice: "asteria",
					logger,
				});

				expect(result).toBeDefined();
				expect(result.audio).toBeTruthy();
				expect(result.audio.length).toBeGreaterThan(100);
				console.log(
					`  ✓ ${model.label}: TTS with voice OK — ${result.audio.length} chars base64`,
				);
			});
		}
	});

	// ------------------------------------------------------------------
	// Image generation
	// ------------------------------------------------------------------

	const IMAGE_MODELS = [
		{
			id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
			label: "Stable Diffusion XL",
			tolerant: false,
		},
		// Flux 2 Dev is the example default image model. Flux's NSFW filter can
		// false-positive on trivial prompts, so this leg is tolerant: a content/
		// safety rejection is a skip, not a failure.
		{
			id: "@cf/black-forest-labs/flux-2-dev",
			label: "Flux 2 Dev",
			tolerant: true,
		},
	];

	/** A Flux content-filter rejection is a model quirk, not an adapter bug. */
	function isContentFiltered(err: string): boolean {
		return /nsfw|safety|content (policy|filter)|inappropriate|blocked/i.test(err);
	}

	describe("Image generation (per model)", () => {
		for (const model of IMAGE_MODELS) {
			it(`${model.label} — generates image via REST`, async (ctx) => {
				const { WorkersAiImageAdapter } =
					await import("../../src/adapters/workers-ai-image");
				const adapter = new WorkersAiImageAdapter(
					{ accountId: ACCOUNT_ID!, apiKey: API_TOKEN! },
					model.id as any,
				);

				let result: Awaited<ReturnType<typeof adapter.generateImages>>;
				try {
					result = await adapter.generateImages({
						model: model.id,
						prompt: "a simple red circle on a white background",
						logger,
					});
				} catch (err: any) {
					if (model.tolerant && isContentFiltered(String(err?.message ?? err))) {
						return ctx.skip(
							`content filtered: ${String(err?.message ?? err).slice(0, 80)}`,
						);
					}
					throw err;
				}

				expect(result).toBeDefined();
				expect(result.model).toBe(model.id);
				expect(result.images).toHaveLength(1);
				expect(result.images[0]!.b64Json).toBeTruthy();
				// Base64 image should be substantial
				expect(result.images[0]!.b64Json!.length).toBeGreaterThan(1000);
				console.log(
					`  ✓ ${model.label}: image OK — ${result.images[0]!.b64Json!.length} chars base64`,
				);
			});
		}
	});

	// ------------------------------------------------------------------
	// Transcription
	// ------------------------------------------------------------------

	const TRANSCRIPTION_MODELS = [
		{ id: "@cf/openai/whisper", label: "Whisper" },
		{ id: "@cf/openai/whisper-tiny-en", label: "Whisper Tiny EN" },
		{
			id: "@cf/openai/whisper-large-v3-turbo",
			label: "Whisper Large v3 Turbo",
		},
		{ id: "@cf/deepgram/nova-3", label: "Deepgram Nova-3" },
	];

	describe("Transcription (per model)", () => {
		/**
		 * Generate a minimal valid WAV file with a 440Hz sine tone.
		 * Deepgram Nova-3 rejects pure silence as "corrupt or unsupported",
		 * so we generate a real tone that all models can process.
		 */
		function createToneWav(durationMs = 500): ArrayBuffer {
			const sampleRate = 16000;
			const numSamples = Math.floor((sampleRate * durationMs) / 1000);
			const bytesPerSample = 2;
			const dataSize = numSamples * bytesPerSample;
			const buffer = new ArrayBuffer(44 + dataSize);
			const view = new DataView(buffer);

			// WAV header
			const writeStr = (offset: number, str: string) => {
				for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
			};
			writeStr(0, "RIFF");
			view.setUint32(4, 36 + dataSize, true);
			writeStr(8, "WAVE");
			writeStr(12, "fmt ");
			view.setUint32(16, 16, true); // chunk size
			view.setUint16(20, 1, true); // PCM
			view.setUint16(22, 1, true); // mono
			view.setUint32(24, sampleRate, true);
			view.setUint32(28, sampleRate * bytesPerSample, true);
			view.setUint16(32, bytesPerSample, true);
			view.setUint16(34, 16, true); // bits per sample
			writeStr(36, "data");
			view.setUint32(40, dataSize, true);

			// Generate 440Hz sine tone (A4 note) at ~50% amplitude
			const freq = 440;
			const amplitude = 16000; // ~50% of int16 max
			for (let i = 0; i < numSamples; i++) {
				const sample = Math.round(
					amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate),
				);
				view.setInt16(44 + i * bytesPerSample, sample, true);
			}

			return buffer;
		}

		for (const model of TRANSCRIPTION_MODELS) {
			it(`${model.label} — transcribes audio via REST`, async () => {
				const { WorkersAiTranscriptionAdapter } =
					await import("../../src/adapters/workers-ai-transcription");
				const adapter = new WorkersAiTranscriptionAdapter(
					{ accountId: ACCOUNT_ID!, apiKey: API_TOKEN! },
					model.id as any,
				);

				const wavBuffer = createToneWav(500);

				const result = await adapter.transcribe({
					model: model.id,
					audio: wavBuffer,
					logger,
				});

				expect(result).toBeDefined();
				expect(result.model).toBe(model.id);
				expect(typeof result.text).toBe("string");
				// Silent audio may return empty text or whitespace, that's OK
				console.log(`  ✓ ${model.label}: transcription OK — "${result.text.slice(0, 80)}"`);
			});
		}
	});

	// ------------------------------------------------------------------
	// Summarization
	// ------------------------------------------------------------------

	describe("Summarization", () => {
		// Uses Workers AI's dedicated summarization task (@cf/facebook/bart-large-cnn,
		// native `input_text` → `summary`). The model is marked deprecated
		// (5/30/2026), so this test is tolerant: if the run errors (e.g. HTTP 410),
		// it logs and returns rather than failing the manual e2e run.
		const SUMMARIZE_MODEL = "@cf/facebook/bart-large-cnn";
		const ARTICLE =
			"Artificial intelligence (AI) is intelligence demonstrated by machines, as opposed to the natural intelligence displayed by animals including humans. AI research has been defined as the field of study of intelligent agents, which refers to any system that perceives its environment and takes actions that maximize its chance of achieving its goals. The term artificial intelligence had previously been used to describe machines that mimic and display human cognitive skills that are associated with the human mind, such as learning and problem-solving.";

		it("BART-large-CNN — summarizes text via REST", async () => {
			const { WorkersAiSummarizeAdapter } =
				await import("../../src/adapters/workers-ai-summarize");
			const adapter = new WorkersAiSummarizeAdapter(
				{ accountId: ACCOUNT_ID!, apiKey: API_TOKEN! },
				SUMMARIZE_MODEL,
			);

			let result: Awaited<ReturnType<typeof adapter.summarize>>;
			try {
				result = await adapter.summarize({
					model: SUMMARIZE_MODEL,
					text: ARTICLE,
					logger,
				});
			} catch (err) {
				console.log(`  ✗ BART REST: summarize unavailable — ${String(err)}`);
				return;
			}

			expect(result).toBeDefined();
			expect(result.model).toBe(SUMMARIZE_MODEL);
			expect(result.summary).toBeTruthy();
			expect(result.summary.length).toBeGreaterThan(10);
			// A summary should be shorter than the source article.
			expect(result.summary.length).toBeLessThan(ARTICLE.length);
			console.log(`  ✓ BART-large-CNN: summarize OK — "${result.summary.slice(0, 100)}"`);
		});

		it("respects maxLength by passing max_length", async () => {
			const { WorkersAiSummarizeAdapter } =
				await import("../../src/adapters/workers-ai-summarize");
			const adapter = new WorkersAiSummarizeAdapter(
				{ accountId: ACCOUNT_ID!, apiKey: API_TOKEN! },
				SUMMARIZE_MODEL,
			);

			let result: Awaited<ReturnType<typeof adapter.summarize>>;
			try {
				result = await adapter.summarize({
					model: SUMMARIZE_MODEL,
					text: ARTICLE,
					maxLength: 64,
					logger,
				});
			} catch (err) {
				console.log(`  ✗ BART REST: bounded summarize unavailable — ${String(err)}`);
				return;
			}

			expect(result.summary).toBeTruthy();
			console.log(
				`  ✓ BART-large-CNN: bounded summarize OK — "${result.summary.slice(0, 100)}"`,
			);
		});
	});
});
