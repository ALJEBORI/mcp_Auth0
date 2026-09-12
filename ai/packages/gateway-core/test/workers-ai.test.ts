import { describe, expect, it } from "vitest";
import {
	getToolNames,
	isForcedToolChoice,
	normalizeMessagesForBinding,
	parseLeakedToolCalls,
	processText,
	SSEDecoder,
} from "../src/workers-ai";

async function decode(chunks: string[]): Promise<string[]> {
	const enc = new TextEncoder();
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(enc.encode(c));
			controller.close();
		},
	});
	const out: string[] = [];
	const reader = source.pipeThrough(new SSEDecoder()).getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

describe("SSEDecoder", () => {
	it("emits payloads after `data: ` and `data:`", async () => {
		expect(await decode(["data: hello\n", "data:world\n"])).toEqual(["hello", "world"]);
	});

	it("buffers payloads split across chunks", async () => {
		expect(await decode(["data: hel", "lo\n"])).toEqual(["hello"]);
	});

	it("flushes a trailing un-newlined payload", async () => {
		expect(await decode(["data: tail"])).toEqual(["tail"]);
	});

	it("ignores blank lines + non-data lines", async () => {
		expect(await decode(["\n", "event: ping\n", "data: x\n"])).toEqual(["x"]);
	});
});

describe("normalizeMessagesForBinding", () => {
	it("coerces null/undefined content to empty string", () => {
		const out = normalizeMessagesForBinding([
			{ role: "assistant", content: null },
			{ role: "assistant", content: undefined },
			{ role: "user", content: "hi" },
		]);
		expect(out[0].content).toBe("");
		expect(out[1].content).toBe("");
		expect(out[2].content).toBe("hi");
	});

	it("passes content arrays (vision parts) through untouched", () => {
		const parts = [{ type: "image_url", image_url: { url: "x" } }];
		const out = normalizeMessagesForBinding([{ role: "user", content: parts }]);
		expect(out[0].content).toBe(parts);
	});
});

describe("processText", () => {
	it("reads OpenAI choices[].message.content", () => {
		expect(processText({ choices: [{ message: { content: "hello" } }] })).toBe("hello");
	});

	it("reads the native response string", () => {
		expect(processText({ response: "native" })).toBe("native");
	});

	it("JSON-stringifies an object response (structured output)", () => {
		expect(processText({ response: { a: 1 } })).toBe('{"a":1}');
	});

	it("stringifies a numeric response", () => {
		expect(processText({ response: 42 })).toBe("42");
	});

	it("returns undefined when there is no content", () => {
		expect(processText({})).toBeUndefined();
		expect(processText({ response: null })).toBeUndefined();
		expect(processText({ choices: [{ message: { content: "" } }] })).toBeUndefined();
	});
});

describe("isForcedToolChoice", () => {
	it("is true for required + named function", () => {
		expect(isForcedToolChoice("required")).toBe(true);
		expect(isForcedToolChoice({ type: "function", function: { name: "f" } })).toBe(true);
	});

	it("is false for auto/none/undefined", () => {
		expect(isForcedToolChoice("auto")).toBe(false);
		expect(isForcedToolChoice("none")).toBe(false);
		expect(isForcedToolChoice(undefined)).toBe(false);
	});
});

describe("getToolNames", () => {
	it("collects defined function names", () => {
		const names = getToolNames([
			{ function: { name: "getWeather" } },
			{ function: { name: "search" } },
			{ function: {} },
		]);
		expect([...names].sort()).toEqual(["getWeather", "search"]);
	});

	it("returns an empty set for undefined tools", () => {
		expect(getToolNames(undefined).size).toBe(0);
	});
});

describe("parseLeakedToolCalls", () => {
	const known = new Set(["getWeather"]);

	it("recovers a known tool from leaked JSON with `arguments`", () => {
		const out = parseLeakedToolCalls('{"name":"getWeather","arguments":{"city":"SF"}}', known);
		expect(out).toEqual([{ toolName: "getWeather", input: '{"city":"SF"}' }]);
	});

	it("recovers from flattened sibling args", () => {
		const out = parseLeakedToolCalls('{"name":"getWeather","city":"SF"}', known);
		expect(out).toEqual([{ toolName: "getWeather", input: '{"city":"SF"}' }]);
	});

	it("recovers from a `parameters` wrapper", () => {
		const out = parseLeakedToolCalls('{"name":"getWeather","parameters":{"city":"NY"}}', known);
		expect(out).toEqual([{ toolName: "getWeather", input: '{"city":"NY"}' }]);
	});

	it("recovers multiple from an array", () => {
		const out = parseLeakedToolCalls(
			'[{"name":"getWeather","arguments":{"city":"A"}},{"name":"getWeather","arguments":{"city":"B"}}]',
			known,
		);
		expect(out).toHaveLength(2);
	});

	it("ignores unknown names (harmony channel/role leaks, hallucinations)", () => {
		expect(parseLeakedToolCalls('{"name":"analysis"}', known)).toEqual([]);
		expect(parseLeakedToolCalls('{"name":"madeUp","arguments":{}}', known)).toEqual([]);
	});

	it("returns [] for non-JSON / prose", () => {
		expect(parseLeakedToolCalls("just some text", known)).toEqual([]);
		expect(parseLeakedToolCalls("", known)).toEqual([]);
	});

	it("preserves a pre-stringified arguments value", () => {
		const out = parseLeakedToolCalls(
			'{"name":"getWeather","arguments":"{\\"city\\":\\"SF\\"}"}',
			known,
		);
		expect(out).toEqual([{ toolName: "getWeather", input: '{"city":"SF"}' }]);
	});
});
