import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createWorkersAiChat } from "../src/adapters/workers-ai";
import { createWorkersAiBindingFetch, type WorkersAiBinding } from "../src/utils/create-fetcher";

type MockBinding = WorkersAiBinding & { run: Mock; fetch: Mock };

function mockBinding(run: Mock, fetchImpl?: Mock): MockBinding {
	return {
		run,
		gateway: vi.fn(),
		fetch: fetchImpl ?? vi.fn(),
	} as unknown as MockBinding;
}

function sseStream(...events: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const e of events) controller.enqueue(encoder.encode(e));
			controller.close();
		},
	});
}

/**
 * Emits the given events (each delivered on its own pull so the consumer
 * actually reads them) then errors mid-stream — simulating a transient drop.
 * Note: `controller.error()` resets any queued-but-unread chunks, so we must
 * deliver each chunk on a separate pull rather than enqueue-then-error.
 */
function droppingStream(...events: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let i = 0;
	return new ReadableStream({
		pull(controller) {
			if (i < events.length) {
				controller.enqueue(encoder.encode(events[i++]!));
			} else {
				controller.error(new Error("simulated mid-stream drop"));
			}
		},
	});
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}
	return text;
}

function runPathResponse(
	body: ReadableStream<Uint8Array>,
	headers: Record<string, string>,
): Response {
	return new Response(body, {
		headers: { "content-type": "text/event-stream", ...headers },
	});
}

// ---------------------------------------------------------------------------
// Run path + resume (Phase 2)
// ---------------------------------------------------------------------------

describe("createWorkersAiBindingFetch — run path + resume", () => {
	afterEach(() => vi.restoreAllMocks());

	it("dispatches through the run path with returnRawResponse + gateway when `gateway` is set", async () => {
		const run = vi.fn().mockResolvedValue(
			runPathResponse(sseStream('data: {"response":"hi"}\n\n', "data: [DONE]\n\n"), {
				"cf-aig-run-id": "run-1",
			}),
		);
		const binding = mockBinding(run);
		const fetcher = createWorkersAiBindingFetch(binding, {
			gateway: "my-gw",
			resume: true,
		});

		const response = await fetcher("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
			}),
		});

		expect(run).toHaveBeenCalledOnce();
		const [, , options] = run.mock.calls[0]!;
		expect(options.gateway).toEqual({ id: "my-gw" });
		expect(options.returnRawResponse).toBe(true);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");

		const text = await readAll(response.body!);
		expect(text).toContain('"content":"hi"');
	});

	it("transparently resumes a mid-stream drop (resume wraps BEFORE the SSE transform)", async () => {
		// Initial run-path body emits one complete event then drops.
		const initial = droppingStream('data: {"response":"Hello"}\n\n');
		const run = vi
			.fn()
			.mockResolvedValue(runPathResponse(initial, { "cf-aig-run-id": "run-123" }));

		// The resume fetch continues from the next event boundary.
		const resumeFetch = vi.fn().mockResolvedValue(
			new Response(sseStream('data: {"response":" world"}\n\n', "data: [DONE]\n\n"), {
				status: 200,
			}),
		);

		const binding = mockBinding(run, resumeFetch);
		const fetcher = createWorkersAiBindingFetch(binding, {
			gateway: "test-gw",
			resume: true,
		});

		const response = await fetcher("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
			}),
		});

		const text = await readAll(response.body!);

		// Resume fetch was issued from the correct event offset (1 complete event emitted).
		expect(resumeFetch).toHaveBeenCalledOnce();
		const resumeUrl = String(resumeFetch.mock.calls[0]![0]);
		expect(resumeUrl).toContain("/gateways/test-gw/run/run-123/resume?from=1");

		// Both halves made it through, in OpenAI-transformed form.
		expect(text).toContain('"content":"Hello"');
		expect(text).toContain('"content":" world"');
		expect(text).toContain('"finish_reason":"stop"');
	});

	it("no-ops resume and warns once when no cf-aig-run-id is returned", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const run = vi
			.fn()
			.mockResolvedValue(
				runPathResponse(sseStream('data: {"response":"x"}\n\n', "data: [DONE]\n\n"), {}),
			);
		const resumeFetch = vi.fn();
		const binding = mockBinding(run, resumeFetch);
		const fetcher = createWorkersAiBindingFetch(binding, {
			gateway: "gw",
			resume: true,
		});

		const response = await fetcher("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
			}),
		});

		const text = await readAll(response.body!);
		expect(text).toContain('"content":"x"');
		// Resume was NOT attempted (no run-id), and we warned.
		expect(resumeFetch).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
		expect(String(warn.mock.calls[0]![0])).toMatch(/cf-aig-run-id/);
	});

	it("gracefully degrades when a streaming run-path request returns a non-SSE body", async () => {
		const run = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ response: "complete, not streamed" }), {
				headers: {
					"content-type": "application/json",
					"cf-aig-run-id": "run-9",
				},
			}),
		);
		const binding = mockBinding(run);
		const fetcher = createWorkersAiBindingFetch(binding, {
			gateway: "gw",
			resume: true,
		});

		const response = await fetcher("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
			}),
		});

		expect(response.headers.get("Content-Type")).toBe("application/json");
		const json = (await response.json()) as {
			choices: Array<{ message: { content: string }; finish_reason: string }>;
		};
		expect(json.choices[0]!.message.content).toBe("complete, not streamed");
		expect(json.choices[0]!.finish_reason).toBe("stop");
	});

	it("does NOT use the run path when `gateway` is not set (plain binding, no resume)", async () => {
		const run = vi
			.fn()
			.mockResolvedValue(sseStream('data: {"response":"hi"}\n\n', "data: [DONE]\n\n"));
		const binding = mockBinding(run);
		const fetcher = createWorkersAiBindingFetch(binding, { resume: true });

		await fetcher("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
			}),
		});

		const [, , options] = run.mock.calls[0]! as [
			unknown,
			unknown,
			Record<string, unknown> | undefined,
		];
		// Legacy path: no returnRawResponse / gateway run options.
		if (options) {
			expect(options).not.toHaveProperty("returnRawResponse");
			expect(options).not.toHaveProperty("gateway");
		}
	});

	it("warns when resume is requested on a direct binding without a gateway id", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const binding = mockBinding(vi.fn());
		createWorkersAiChat("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
			binding,
			resume: true,
		});
		expect(warn).toHaveBeenCalled();
		expect(String(warn.mock.calls[0]![0])).toMatch(/requires a `gateway`/);
	});
});
