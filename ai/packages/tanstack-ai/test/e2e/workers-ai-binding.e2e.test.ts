/**
 * E2E integration tests for Workers AI via the env.AI binding.
 *
 * These tests start a real wrangler dev server with a test worker that exercises
 * our adapter through the Workers AI binding path. Unlike the REST E2E tests,
 * these validate the full binding fetch shim, including:
 *   - Stream transformer (nested tool call format)
 *   - Message normalization (null content, tool_call_id sanitization)
 *   - Tool call round-trips through the binding
 *
 * Prerequisites:
 *   - Authenticated with Cloudflare (`wrangler login` or CLOUDFLARE_API_TOKEN env var)
 *   - `pnpm build` has been run (the test worker imports from source, but openai dep
 *     must be resolvable)
 *
 * Run with: pnpm test:e2e
 */
import { type ChildProcess, spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WORKER_DIR = new URL("./fixtures/binding-worker", import.meta.url).pathname;
const PORT = 8799;
const BASE = `http://localhost:${PORT}`;

// Models to test — same set as the REST e2e tests for apples-to-apples
// comparison, aligned with examples/workers-ai/src/client/components/models.ts
// (GLM 5.2 default + Nemotron 3; retired llama-3.x / gemma-3 ids removed).
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
] as const;

// ---------------------------------------------------------------------------
// Results tracker
// ---------------------------------------------------------------------------

type Status = "ok" | "warn" | "fail";

const results: Record<
	string,
	{
		chat: Status;
		multiTurn: Status;
		toolCall: Status;
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
			toolCall: "fail",
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
	console.log("  WORKERS AI BINDING INTEGRATION TEST RESULTS");
	console.log(sep);
	console.log(header);
	console.log(sep);

	for (const label of labels) {
		const r = results[label]!;
		const notes = r.notes.length > 0 ? r.notes.join("; ") : "";
		console.log(
			`${pad(label, maxLabel)} | ${statusIcon(r.chat)} | ${statusIcon(r.multiTurn)} | ${statusIcon(r.toolCall)} | ${statusIcon(r.toolRoundTrip)} | ${statusIcon(r.structuredOutput)} | ${statusIcon(r.reasoning)} | ${notes}`,
		);
	}

	console.log(sep);
	console.log("  OK = works correctly    ~ = partial/quirky    X = broken/error    - = N/A");
	console.log("  T-RT = tool round-trip    Think = reasoning (STEP_STARTED/STEP_FINISHED)");
	console.log(sep);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST JSON to the test worker and parse the response */
async function post(path: string, body: Record<string, unknown> = {}) {
	const res = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json() as Promise<Record<string, unknown>>;
}

/** Find a chunk by type in an array */
function findChunk(chunks: any[], type: string) {
	return chunks.find((c: any) => c.type === type);
}

/** Filter chunks by type */
function filterChunks(chunks: any[], type: string) {
	return chunks.filter((c: any) => c.type === type);
}

/** Wait for a URL to respond with 200 */
async function waitForReady(url: string, timeoutMs = 45_000): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return true;
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

// ---------------------------------------------------------------------------
// Wrangler dev lifecycle
// ---------------------------------------------------------------------------

let wranglerProcess: ChildProcess | null = null;
let serverReady = false;

describe("Workers AI Binding E2E", () => {
	beforeAll(async () => {
		// Start wrangler dev in the background
		wranglerProcess = spawn(
			"pnpm",
			["exec", "wrangler", "dev", "--port", String(PORT), "--log-level", "error"],
			{
				cwd: WORKER_DIR,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			},
		);

		// Collect stderr for debugging if it fails to start
		let stderr = "";
		wranglerProcess.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		wranglerProcess.on("error", (err) => {
			console.error("[binding-e2e] Failed to start wrangler:", err.message);
		});

		// Wait for server to be ready
		serverReady = await waitForReady(`${BASE}/health`, 50_000);
		if (!serverReady) {
			console.error("[binding-e2e] wrangler dev failed to start within 50s");
			if (stderr) console.error("[binding-e2e] stderr:", stderr);
		}
	}, 60_000);

	afterAll(async () => {
		printSummaryTable();
		if (wranglerProcess) {
			wranglerProcess.kill("SIGTERM");
			// Give it a moment to shut down
			await new Promise((r) => setTimeout(r, 1_000));
			if (!wranglerProcess.killed) {
				wranglerProcess.kill("SIGKILL");
			}
			wranglerProcess = null;
		}
	}, 10_000);

	// ------------------------------------------------------------------
	// Per-model: basic chat
	// ------------------------------------------------------------------

	describe("chat (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — basic chat via binding`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);
				const data = await post("/chat", { model: model.id });
				const chunks = data.chunks as any[];

				if (data.error) {
					r.chat = "fail";
					r.notes.push(`chat: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const started = findChunk(chunks, "RUN_STARTED");
				const finished = findChunk(chunks, "RUN_FINISHED");
				const content = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");
				const runError = findChunk(chunks, "RUN_ERROR");

				if (runError) {
					r.chat = "fail";
					r.notes.push(`chat: ${runError.error?.message?.slice(0, 40)}`);
					return;
				}

				expect(started).toBeDefined();
				expect(finished).toBeDefined();

				if (content.length > 0) {
					r.chat = "ok";
				} else {
					r.chat = "warn";
					r.notes.push("chat: 0 content chunks");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: multi-turn
	// ------------------------------------------------------------------

	describe("multi-turn (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — multi-turn via binding`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);
				const data = await post("/chat/multi-turn", { model: model.id });
				const chunks = data.chunks as any[];

				if (data.error) {
					r.multiTurn = "fail";
					r.notes.push(`turn: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const runError = findChunk(chunks, "RUN_ERROR");
				if (runError) {
					r.multiTurn = "fail";
					r.notes.push(`turn: ${runError.error?.message?.slice(0, 40)}`);
					return;
				}

				const content = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");
				if (content.length === 0) {
					r.multiTurn = "warn";
					r.notes.push("turn: no content");
					return;
				}

				const fullText = content[content.length - 1].content;
				if (fullText.toLowerCase().includes("alice")) {
					r.multiTurn = "ok";
				} else {
					r.multiTurn = "warn";
					r.notes.push("turn: forgot context");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: tool calling (first round)
	// ------------------------------------------------------------------

	describe("tool call (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — tool call via binding`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);
				const data = await post("/chat/tool-call", { model: model.id });
				const chunks = data.chunks as any[];

				if (data.error) {
					r.toolCall = "fail";
					r.notes.push(`tool: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const runError = findChunk(chunks, "RUN_ERROR");
				if (runError) {
					r.toolCall = "fail";
					r.notes.push(`tool: ${runError.error?.message?.slice(0, 40)}`);
					return;
				}

				const toolStarts = filterChunks(chunks, "TOOL_CALL_START");
				const toolEnds = filterChunks(chunks, "TOOL_CALL_END");

				if (toolStarts.length >= 1) {
					// Verify the tool name was correctly parsed
					expect(toolStarts[0].toolName).toBe("calculator");
					r.toolCall = "ok";
				} else {
					const content = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");
					if (content.length > 0) {
						r.toolCall = "warn";
						r.notes.push("tool: answered as text");
					} else {
						r.toolCall = "fail";
						r.notes.push("tool: no tool call or content");
					}
				}

				if (toolStarts.length > 0 && toolEnds.length > 0) {
					expect(toolStarts[0].toolCallId).toBeDefined();
					expect(toolEnds[0].toolCallId).toBeDefined();
					expect(toolStarts[0].toolCallId).toBe(toolEnds[0].toolCallId);
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: tool call through the real StreamProcessor
	// Regression guard for https://github.com/cloudflare/ai/issues/523 —
	// the resulting UIMessage tool-call part must carry its `name` (and args).
	// ------------------------------------------------------------------

	describe("tool call → StreamProcessor part (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — processed tool-call part has a name`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);
				const data = await post("/chat/tool-call-processed", {
					model: model.id,
				});

				if (data.error) {
					r.notes.push(`tool-proc: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const parts = (data.toolCallParts as any[]) ?? [];

				if (parts.length === 0) {
					// Model may have answered as text instead of calling the tool.
					// The dedicated tool-call test already records that; don't fail here.
					r.notes.push("tool-proc: no tool-call part");
					return;
				}

				// The core regression: every tool-call part MUST have a non-empty
				// name, otherwise dispatch silently fails (issue #523).
				for (const part of parts) {
					expect(part.name, "tool-call part is missing its name").toBeTruthy();
					expect(part.state).toBe("input-complete");
					// Arguments must be valid JSON the consumer can dispatch.
					expect(() => JSON.parse(part.arguments)).not.toThrow();
				}

				expect(parts[0].name).toBe("calculator");
				console.log(
					`  ✓ ${model.label}: processed tool-call part OK — name="${parts[0].name}" args=${parts[0].arguments}`,
				);
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: tool round-trip (the key test for the binding bug fix)
	// ------------------------------------------------------------------

	describe("tool round-trip (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — tool round-trip via binding`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);
				const data = await post("/chat/tool-roundtrip", { model: model.id });

				if (data.error) {
					r.toolRoundTrip = "fail";
					r.notes.push(`t-rt: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const step1 = data.step1Chunks as any[];
				const step2 = data.step2Chunks as any[] | undefined;

				// Verify step 1 produced a tool call
				const toolStart = findChunk(step1, "TOOL_CALL_START");
				const toolEnd = findChunk(step1, "TOOL_CALL_END");

				if (!toolStart || !toolEnd || !toolEnd.toolName) {
					// Model skipped tool
					const content = filterChunks(step1, "TEXT_MESSAGE_CONTENT");
					if (content.length > 0) {
						r.toolRoundTrip = "warn";
						r.notes.push("t-rt: skipped tool, answered directly");
					} else {
						r.toolRoundTrip = "fail";
						r.notes.push("t-rt: step1 no tool call or content");
					}
					return;
				}

				// Verify step 2 (tool result → text response)
				if (!step2) {
					r.toolRoundTrip = "fail";
					r.notes.push("t-rt: step2 missing");
					return;
				}

				const step2Error = findChunk(step2, "RUN_ERROR");
				if (step2Error) {
					r.toolRoundTrip = "fail";
					r.notes.push(`t-rt: step2 error ${step2Error.error?.message?.slice(0, 30)}`);
					return;
				}

				const step2Content = filterChunks(step2, "TEXT_MESSAGE_CONTENT");
				const step2Finished = findChunk(step2, "RUN_FINISHED");

				if (step2Content.length > 0 && step2Finished) {
					const text = step2Content[step2Content.length - 1].content;
					r.toolRoundTrip = "ok";
					console.log(
						`  ✓ ${model.label}: binding tool round-trip OK — "${text.slice(0, 80)}"`,
					);
				} else if (step2Finished) {
					r.toolRoundTrip = "fail";
					r.notes.push("t-rt: step2 finished but 0 content");
				} else {
					r.toolRoundTrip = "fail";
					r.notes.push("t-rt: step2 no finish");
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
			it(`${model.label} — emits STEP_STARTED/STEP_FINISHED for reasoning`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);

				const data = await post("/chat/stream", {
					model: model.id,
					messages: [
						{
							role: "user",
							content: "What is 15 * 37? Think step by step before answering.",
						},
					],
				});

				if (data.error) {
					r.reasoning = "fail";
					r.notes.push(`reasoning: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const chunks = data.chunks as any[];
				if (!chunks || chunks.length === 0) {
					r.reasoning = "fail";
					r.notes.push("reasoning: no chunks");
					return;
				}

				const runError = findChunk(chunks, "RUN_ERROR");
				if (runError) {
					r.reasoning = "fail";
					r.notes.push(`reasoning: ${runError.error?.message?.slice(0, 40)}`);
					return;
				}

				const stepStarted = findChunk(chunks, "STEP_STARTED");
				const stepFinished = filterChunks(chunks, "STEP_FINISHED");

				if (stepStarted && stepFinished.length > 0) {
					// Verify STEP_STARTED has correct fields
					if (stepStarted.stepType !== "thinking") {
						r.reasoning = "warn";
						r.notes.push(`reasoning: stepType=${stepStarted.stepType}`);
						return;
					}

					// Verify accumulated content is non-empty
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
				if (!serverReady) return;

				const r = getResult(model.label);

				// Mark as N/A by default for non-reasoning models
				r.reasoning = "ok";

				const data = await post("/chat/stream", {
					model: model.id,
					messages: [{ role: "user", content: "Say hello in one sentence." }],
				});

				if (data.error) {
					// Don't mark reasoning as failed for non-reasoning models — the
					// chat test already captures this. Just skip.
					return;
				}

				const chunks = data.chunks as any[];
				if (!chunks) return;

				const stepStarted = findChunk(chunks, "STEP_STARTED");
				if (stepStarted) {
					// Unexpected — this model emitted reasoning events
					r.reasoning = "warn";
					r.notes.push("reasoning: unexpected STEP events");
				}
			});
		}
	});

	// ------------------------------------------------------------------
	// Per-model: structured output
	// ------------------------------------------------------------------

	describe("structured output (per model)", () => {
		for (const model of MODELS) {
			it(`${model.label} — structured output via binding`, async () => {
				if (!serverReady) return;

				const r = getResult(model.label);
				const data = await post("/chat/structured", { model: model.id });

				if (data.error) {
					r.structuredOutput = "fail";
					r.notes.push(`json: ${(data.error as string).slice(0, 40)}`);
					return;
				}

				const result = data.result as any;
				if (!result) {
					r.structuredOutput = "fail";
					r.notes.push("json: no result");
					return;
				}

				if (typeof result.data === "object" && result.data !== null) {
					const d = result.data;
					if (d.name && d.capital) {
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
	// Resume-enabled run path (gateway). Proves the resume wiring engages
	// end-to-end against a live gateway. A true mid-stream drop + byte-exact
	// reconstruction is covered by the workers-ai-provider gateway e2e and the
	// integration tests; here we assert the resumable run path streams cleanly.
	// ------------------------------------------------------------------

	describe("resume (run path)", () => {
		it("streams text through the resume-enabled run path", async (ctx) => {
			if (!serverReady) return ctx.skip("server not ready");

			const data = await post("/chat/stream-resume", {});
			if (data.error) {
				// Run path / gateway not reachable on this account — classify as skip.
				return ctx.skip(`run path unavailable: ${String(data.error).slice(0, 80)}`);
			}

			const chunks = data.chunks as any[];
			const runError = findChunk(chunks, "RUN_ERROR");
			if (runError) {
				return ctx.skip(
					`run path RUN_ERROR: ${String(runError.error?.message).slice(0, 80)}`,
				);
			}

			const content = filterChunks(chunks, "TEXT_MESSAGE_CONTENT");
			const finished = findChunk(chunks, "RUN_FINISHED");
			expect(content.length).toBeGreaterThan(0);
			expect(finished).toBeDefined();
		}, 30_000);
	});

	// ==================================================================
	// Non-chat capabilities via binding
	// ==================================================================

	// ------------------------------------------------------------------
	// TTS via binding
	// ------------------------------------------------------------------

	describe("TTS via binding", () => {
		it("Deepgram Aura-1 — generates audio", async () => {
			if (!serverReady) return;

			const data = await post("/tts", {
				model: "@cf/deepgram/aura-1",
				text: "Hello, this is a test of text to speech via the binding.",
			});

			if (data.error) {
				console.log(`  ✗ TTS binding: ${data.error}`);
				return;
			}

			expect(data.audio).toBeTruthy();
			expect(typeof data.audio).toBe("string");
			expect((data.audio as string).length).toBeGreaterThan(100);
			console.log(
				`  ✓ Deepgram Aura-1 binding: TTS OK — ${(data.audio as string).length} chars base64`,
			);
		});

		it("Deepgram Aura-1 — generates audio with voice option", async () => {
			if (!serverReady) return;

			const data = await post("/tts", {
				model: "@cf/deepgram/aura-1",
				text: "Testing voice parameter.",
				voice: "asteria",
			});

			if (data.error) {
				console.log(`  ✗ TTS binding (voice): ${data.error}`);
				return;
			}

			expect(data.audio).toBeTruthy();
			expect((data.audio as string).length).toBeGreaterThan(100);
			console.log(`  ✓ Deepgram Aura-1 binding: TTS with voice OK`);
		});

		it("Deepgram Aura-2 EN — generates audio via binding", async () => {
			if (!serverReady) return;

			const data = await post("/tts", {
				model: "@cf/deepgram/aura-2-en",
				text: "Hello, this is a test of Aura two text to speech via the binding.",
			});

			if (data.error) {
				console.log(`  ✗ TTS Aura-2 EN binding: ${data.error}`);
				return;
			}

			expect(typeof data.audio).toBe("string");
			expect((data.audio as string).length).toBeGreaterThan(100);
			console.log(
				`  ✓ Deepgram Aura-2 EN binding: TTS OK — ${(data.audio as string).length} chars base64`,
			);
		});
	});

	// ------------------------------------------------------------------
	// Transcription via binding
	// ------------------------------------------------------------------

	const TRANSCRIPTION_MODELS_BINDING = [
		{ id: "@cf/openai/whisper", label: "Whisper" },
		{ id: "@cf/openai/whisper-tiny-en", label: "Whisper Tiny EN" },
		{
			id: "@cf/openai/whisper-large-v3-turbo",
			label: "Whisper Large v3 Turbo",
		},
		{ id: "@cf/deepgram/nova-3", label: "Deepgram Nova-3" },
	];

	describe("Transcription via binding", () => {
		/**
		 * Generate a minimal valid WAV with a 440Hz tone as number[].
		 * Deepgram Nova-3 rejects pure silence, so we generate a real tone.
		 */
		function createToneWavBytes(durationMs = 500): number[] {
			const sampleRate = 16000;
			const numSamples = Math.floor((sampleRate * durationMs) / 1000);
			const bytesPerSample = 2;
			const dataSize = numSamples * bytesPerSample;
			const buffer = new ArrayBuffer(44 + dataSize);
			const view = new DataView(buffer);

			const writeStr = (offset: number, str: string) => {
				for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
			};
			writeStr(0, "RIFF");
			view.setUint32(4, 36 + dataSize, true);
			writeStr(8, "WAVE");
			writeStr(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true); // PCM
			view.setUint16(22, 1, true); // mono
			view.setUint32(24, sampleRate, true);
			view.setUint32(28, sampleRate * bytesPerSample, true);
			view.setUint16(32, bytesPerSample, true);
			view.setUint16(34, 16, true);
			writeStr(36, "data");
			view.setUint32(40, dataSize, true);

			// 440Hz sine tone at ~50% amplitude
			const freq = 440;
			const amplitude = 16000;
			for (let i = 0; i < numSamples; i++) {
				const sample = Math.round(
					amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate),
				);
				view.setInt16(44 + i * bytesPerSample, sample, true);
			}

			return Array.from(new Uint8Array(buffer));
		}

		for (const model of TRANSCRIPTION_MODELS_BINDING) {
			it(`${model.label} — transcribes audio via binding`, async () => {
				if (!serverReady) return;

				const audio = createToneWavBytes(500);
				const data = await post("/transcription", {
					model: model.id,
					audio,
				});

				if (data.error) {
					console.log(`  ✗ ${model.label} transcription binding: ${data.error}`);
					return;
				}

				expect(data.model).toBe(model.id);
				expect(typeof data.text).toBe("string");
				console.log(
					`  ✓ ${model.label} binding: transcription OK — "${(data.text as string).slice(0, 80)}"`,
				);
			});
		}
	});

	// ------------------------------------------------------------------
	// Image generation via binding
	// ------------------------------------------------------------------

	describe("Image generation via binding", () => {
		it("Stable Diffusion XL — generates image", async () => {
			if (!serverReady) return;

			const data = await post("/image", {
				model: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
				prompt: "a simple red circle on a white background",
			});

			if (data.error) {
				console.log(`  ✗ Image binding: ${data.error}`);
				return;
			}

			expect(data.imageCount).toBe(1);
			expect(data.imageSize).toBeGreaterThan(1000);
			console.log(`  ✓ SDXL binding: image OK — ${data.imageSize} chars base64`);
		});
	});

	// ------------------------------------------------------------------
	// Summarization via binding
	// ------------------------------------------------------------------

	describe("Summarization via binding", () => {
		it("BART-large-CNN — summarizes text", async () => {
			if (!serverReady) return;

			const data = await post("/summarize", {
				text: "Artificial intelligence (AI) is intelligence demonstrated by machines, as opposed to the natural intelligence displayed by animals including humans. AI research has been defined as the field of study of intelligent agents, which refers to any system that perceives its environment and takes actions that maximize its chance of achieving its goals.",
			});

			if (data.error) {
				console.log(`  ✗ Summarize binding: ${data.error}`);
				return;
			}

			expect(data.summary).toBeTruthy();
			expect(typeof data.summary).toBe("string");
			expect((data.summary as string).length).toBeGreaterThan(10);
			console.log(
				`  ✓ BART binding: summarize OK — "${(data.summary as string).slice(0, 80)}"`,
			);
		});
	});
});
