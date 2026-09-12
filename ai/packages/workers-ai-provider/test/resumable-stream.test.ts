import { describe, expect, it, vi } from "vitest";
import { GatewayDelegateError } from "../src/gateway-delegate";
import { createResumableStream } from "../src/resumable-stream";

const enc = new TextEncoder();

/** A ReadableStream that emits the given string chunks, optionally erroring after `errorAfter` of them. */
function streamFrom(chunks: string[], errorAfter?: number): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (errorAfter !== undefined && i >= errorAfter) {
				controller.error(new Error("simulated mid-stream drop"));
				return;
			}
			if (i >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(enc.encode(chunks[i++]));
		},
	});
}

async function readAll(rs: ReadableStream<Uint8Array>): Promise<string> {
	const reader = rs.getReader();
	const dec = new TextDecoder();
	let out = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		out += dec.decode(value, { stream: true });
	}
	out += dec.decode();
	return out;
}

/** A binding whose `.fetch` returns a 200 stream of the given tail chunks, capturing the resume URL. */
function bindingWithTail(tailChunks: string[], urls: string[]): Ai {
	return {
		fetch: vi.fn(async (url: string) => {
			urls.push(url);
			return new Response(streamFrom(tailChunks), { status: 200 });
		}),
	} as unknown as Ai;
}

describe("createResumableStream", () => {
	it("passes a clean stream through unchanged", async () => {
		const chunks = ["data: a\n\n", "data: b\n\n", "data: [DONE]\n\n"];
		const rs = createResumableStream({
			binding: {} as Ai,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(chunks),
		});
		expect(await readAll(rs)).toBe(chunks.join(""));
	});

	it("flushes a trailing event with no terminator on clean close", async () => {
		const rs = createResumableStream({
			binding: {} as Ai,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(["data: a\n\n", "data: tail-no-term"]),
		});
		expect(await readAll(rs)).toBe("data: a\n\ndata: tail-no-term");
	});

	it("reconnects on a mid-stream error and resumes from the emitted event count", async () => {
		const urls: string[] = [];
		const reconnects: Array<[number, number]> = [];
		// Initial: 2 complete events, then drop on the 3rd read.
		const initial = streamFrom(["data: 1\n\n", "data: 2\n\n"], 2);
		const binding = bindingWithTail(["data: 3\n\n", "data: 4\n\n"], urls);

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r1",
			initial,
			onReconnect: (from, attempt) => reconnects.push([from, attempt]),
		});

		expect(await readAll(rs)).toBe("data: 1\n\ndata: 2\n\ndata: 3\n\ndata: 4\n\n");
		expect(reconnects).toEqual([[2, 1]]);
		expect(urls[0]).toContain("/run/r1/resume?from=2");
	});

	it("discards a partial event and realigns on the boundary after a drop", async () => {
		const urls: string[] = [];
		// 1 complete event, then a partial "data: 2" (no terminator), then drop.
		const initial = streamFrom(["data: 1\n\n", "data: 2"], 2);
		// Gateway replays from event index 1 — the full event 2 plus event 3.
		const binding = bindingWithTail(["data: 2\n\n", "data: 3\n\n"], urls);

		const rs = createResumableStream({ binding, gateway: "gw", runId: "r1", initial });

		// The partial "data: 2" is NOT duplicated — resume realigns cleanly.
		expect(await readAll(rs)).toBe("data: 1\n\ndata: 2\n\ndata: 3\n\n");
		expect(urls[0]).toContain("resume?from=1");
	});

	it("errors with resume-expired on a 404 (default policy)", async () => {
		const binding = {
			fetch: vi.fn(
				async () => new Response('{"error":"Request not found"}', { status: 404 }),
			),
		} as unknown as Ai;

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(["data: 1\n\n"], 1),
		});

		await expect(readAll(rs)).rejects.toMatchObject({
			name: "GatewayDelegateError",
			kind: "resume-expired",
		});
	});

	it('ends cleanly with partial output on 404 when policy is "accept-partial"', async () => {
		const binding = {
			fetch: vi.fn(async () => new Response("not found", { status: 404 })),
		} as unknown as Ai;

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(["data: 1\n\n"], 1),
			onResumeExpired: "accept-partial",
		});

		expect(await readAll(rs)).toBe("data: 1\n\n");
	});

	it("fires onProgress with the cumulative event offset", async () => {
		const offsets: number[] = [];
		const rs = createResumableStream({
			binding: {} as Ai,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(["data: a\n\n", "data: b\n\ndata: c\n\n"]),
			onProgress: (n) => offsets.push(n),
		});
		await readAll(rs);
		// First chunk = 1 event; second chunk = 2 more (cumulative 3).
		expect(offsets).toEqual([1, 3]);
	});

	// ── cross-invocation re-attach (no initial body) ──────────────────────────

	it("re-attaches with no initial body by resuming from fromEvent", async () => {
		const urls: string[] = [];
		const binding = bindingWithTail(["data: 7\n\n", "data: 8\n\n"], urls);

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r9",
			fromEvent: 6,
			// no `initial` — pure re-attach
		});

		expect(await readAll(rs)).toBe("data: 7\n\ndata: 8\n\n");
		expect(urls[0]).toContain("/run/r9/resume?from=6");
	});

	it("continues counting from fromEvent so a later reconnect uses the absolute index", async () => {
		const urls: string[] = [];
		// `initial` provided + fromEvent:6 — the live body delivers 2 events then drops.
		const initial = streamFrom(["data: 7\n\n", "data: 8\n\n"], 2);
		// The only fetch is the reconnect; it must carry the absolute index.
		const binding = bindingWithTail(["data: 9\n\n"], urls);

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r9",
			fromEvent: 6,
			initial,
		});

		expect(await readAll(rs)).toBe("data: 7\n\ndata: 8\n\ndata: 9\n\n");
		// fromEvent(6) + 2 emitted = reconnect at absolute index 8.
		expect(urls[0]).toContain("resume?from=8");
	});

	it("treats an initial-attach 404 as terminal (not charged to the reconnect budget)", async () => {
		const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
		const binding = { fetch: fetchMock } as unknown as Ai;

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "gone",
			fromEvent: 3,
		});

		await expect(readAll(rs)).rejects.toMatchObject({ kind: "resume-expired" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("errors with kind dispatch on a non-404 resume failure", async () => {
		const binding = {
			fetch: vi.fn(async () => new Response("boom", { status: 500 })),
		} as unknown as Ai;

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(["data: 1\n\n"], 1),
		});

		await expect(readAll(rs)).rejects.toMatchObject({
			name: "GatewayDelegateError",
			kind: "dispatch",
		});
	});

	it("gives up after maxReconnects", async () => {
		// Every resume attempt also drops immediately, so we exhaust the budget.
		const binding = {
			fetch: vi.fn(async () => new Response(streamFrom(["x"], 0), { status: 200 })),
		} as unknown as Ai;

		const rs = createResumableStream({
			binding,
			gateway: "gw",
			runId: "r1",
			initial: streamFrom(["data: 1\n\n"], 1),
			maxReconnects: 2,
		});

		await expect(readAll(rs)).rejects.toBeInstanceOf(GatewayDelegateError);
		expect(
			(binding as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch,
		).toHaveBeenCalledTimes(2);
	});
});
