import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createWorkersAiBindingFetch, type WorkersAiBinding } from "../src/utils/create-fetcher";

function mockBinding(run: Mock): WorkersAiBinding {
	return {
		run,
		gateway: vi.fn(),
		fetch: vi.fn(),
	} as unknown as WorkersAiBinding;
}

async function callBinding(
	run: Mock,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const fetcher = createWorkersAiBindingFetch(mockBinding(run));
	const res = await fetcher("https://example.com/v1/chat/completions", {
		method: "POST",
		body: JSON.stringify(body),
	});
	return (await res.json()) as Record<string, unknown>;
}

type Choice = {
	message: {
		content: string;
		tool_calls?: Array<{ function: { name: string; arguments: string } }>;
	};
	finish_reason: string;
};

/**
 * The gpt-oss harmony quirk (cloudflare/ai#560): a forced tool call is returned
 * as JSON text in `response` with an empty `tool_calls` array. tanstack now
 * salvages it on the non-streaming path, matching workers-ai-provider.
 */
describe("forced tool-call salvage (non-streaming binding path)", () => {
	afterEach(() => vi.restoreAllMocks());

	it("recovers a forced tool call the model leaked as text content", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const run = vi.fn().mockResolvedValue({
			response: '{"name":"get_weather","arguments":{"city":"NYC"}}',
			tool_calls: [],
		});

		const json = await callBinding(run, {
			model: "@cf/openai/gpt-oss-120b",
			tool_choice: "required",
			tools: [{ type: "function", function: { name: "get_weather" } }],
			messages: [{ role: "user", content: "weather?" }],
		});

		const choice = (json.choices as Choice[])[0]!;
		expect(choice.finish_reason).toBe("tool_calls");
		expect(choice.message.content).toBe("");
		expect(choice.message.tool_calls).toHaveLength(1);
		expect(choice.message.tool_calls![0]!.function.name).toBe("get_weather");
		expect(JSON.parse(choice.message.tool_calls![0]!.function.arguments)).toEqual({
			city: "NYC",
		});
		expect(warn).toHaveBeenCalledOnce();
	});

	it("recovers the named-function forced form too", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const run = vi.fn().mockResolvedValue({
			response: '{"name":"lookup","query":"x"}',
			tool_calls: [],
		});

		const json = await callBinding(run, {
			model: "@cf/openai/gpt-oss-120b",
			tool_choice: { type: "function", function: { name: "lookup" } },
			tools: [{ type: "function", function: { name: "lookup" } }],
			messages: [{ role: "user", content: "go" }],
		});

		const choice = (json.choices as Choice[])[0]!;
		expect(choice.finish_reason).toBe("tool_calls");
		expect(choice.message.tool_calls![0]!.function.name).toBe("lookup");
	});

	it("does NOT salvage when no tool was forced (leaves content untouched)", async () => {
		const run = vi.fn().mockResolvedValue({
			response: '{"name":"get_weather","arguments":{"city":"NYC"}}',
			tool_calls: [],
		});

		const json = await callBinding(run, {
			model: "@cf/openai/gpt-oss-120b",
			tool_choice: "auto",
			tools: [{ type: "function", function: { name: "get_weather" } }],
			messages: [{ role: "user", content: "weather?" }],
		});

		const choice = (json.choices as Choice[])[0]!;
		expect(choice.finish_reason).toBe("stop");
		expect(choice.message.tool_calls).toBeUndefined();
		expect(choice.message.content).toContain("get_weather");
	});

	it("does NOT salvage an unknown tool name", async () => {
		const run = vi.fn().mockResolvedValue({
			response: '{"name":"some_other_tool","arguments":{}}',
			tool_calls: [],
		});

		const json = await callBinding(run, {
			model: "@cf/openai/gpt-oss-120b",
			tool_choice: "required",
			tools: [{ type: "function", function: { name: "get_weather" } }],
			messages: [{ role: "user", content: "weather?" }],
		});

		const choice = (json.choices as Choice[])[0]!;
		expect(choice.finish_reason).toBe("stop");
		expect(choice.message.tool_calls).toBeUndefined();
	});

	it("prefers real structured tool calls over salvage", async () => {
		const run = vi.fn().mockResolvedValue({
			response: '{"name":"get_weather","arguments":{"city":"NYC"}}',
			tool_calls: [{ name: "real_tool", arguments: { a: 1 } }],
		});

		const json = await callBinding(run, {
			model: "@cf/openai/gpt-oss-120b",
			tool_choice: "required",
			tools: [{ type: "function", function: { name: "get_weather" } }],
			messages: [{ role: "user", content: "weather?" }],
		});

		const choice = (json.choices as Choice[])[0]!;
		expect(choice.finish_reason).toBe("tool_calls");
		expect(choice.message.tool_calls![0]!.function.name).toBe("real_tool");
	});
});
