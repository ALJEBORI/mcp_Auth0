/**
 * E2E tests for the third-party gateway adapters through Cloudflare AI Gateway.
 *
 * Unlike the Workers AI e2e suites (which exercise the binding / REST / run-path
 * transports against `@cf/*` models), this suite drives the OpenAI-, Anthropic-,
 * Gemini-, Grok- and OpenRouter-backed adapters that route their upstream
 * provider through the AI Gateway universal endpoint. It is the only automated
 * coverage of those `createGatewayFetch`-wrapped adapters against live providers.
 *
 * Each provider leg is independently key-gated: a provider runs only when both
 * the shared gateway credentials AND that provider's API key are present, and
 * `skip()`s with a clear reason otherwise (so a partial key set still exercises
 * whatever it can).
 *
 * Prerequisites (in a `.env` at the package root or the environment):
 *   CLOUDFLARE_ACCOUNT_ID=<account id>
 *   CLOUDFLARE_API_TOKEN=<token with AI Gateway access>   # used as cf-aig-authorization
 *   CLOUDFLARE_AI_GATEWAY_ID=<gateway id>                 # or GATEWAY_ID; defaults to "default"
 *   OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY (or GOOGLE_API_KEY) /
 *   GROK_API_KEY (or XAI_API_KEY) / OPENROUTER_API_KEY    # any subset
 *
 * Run with: pnpm test:e2e (or vitest --config vitest.e2e.config.ts gateway-providers)
 */
import { config } from "dotenv";
import { chat } from "@tanstack/ai";
import { afterAll, describe, expect, it } from "vitest";

import { createOpenAiChat } from "../../src/adapters/openai";
import { createAnthropicChat } from "../../src/adapters/anthropic";
import { createGeminiChat } from "../../src/adapters/gemini";
import { createGrokChat } from "../../src/adapters/grok";
import { createOpenRouterChat } from "../../src/adapters/openrouter";
import type { AnyTextAdapter } from "@tanstack/ai";

config({ path: new URL("../../.env", import.meta.url).pathname });

// ---------------------------------------------------------------------------
// Shared gateway credentials
// ---------------------------------------------------------------------------

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const GATEWAY_ID = process.env.CLOUDFLARE_AI_GATEWAY_ID || process.env.GATEWAY_ID || "default";

/** The shared gateway creds are the floor: without them nothing here can run. */
function noGatewayCreds() {
	return !ACCOUNT_ID || !CF_API_TOKEN;
}

/** Build a REST gateway config that forwards the provider key + cf authorization. */
function gwConfig(providerApiKey: string) {
	return {
		accountId: ACCOUNT_ID!,
		gatewayId: GATEWAY_ID,
		cfApiKey: CF_API_TOKEN!,
		apiKey: providerApiKey,
	};
}

// ---------------------------------------------------------------------------
// Provider matrix — each leg gated on its own key
// ---------------------------------------------------------------------------

interface ProviderCase {
	label: string;
	model: string;
	key?: string;
	make: (key: string) => AnyTextAdapter;
}

const PROVIDERS: ProviderCase[] = [
	{
		label: "openai/gpt-5.5",
		model: "gpt-5.5",
		key: process.env.OPENAI_API_KEY,
		make: (key) => createOpenAiChat("gpt-5.5", gwConfig(key)) as AnyTextAdapter,
	},
	{
		label: "anthropic/claude-opus-4.8",
		model: "claude-opus-4.8",
		key: process.env.ANTHROPIC_API_KEY,
		make: (key) => createAnthropicChat("claude-opus-4.8", gwConfig(key)) as AnyTextAdapter,
	},
	{
		label: "gemini/gemini-3.5-flash",
		model: "gemini-3.5-flash",
		key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
		make: (key) => createGeminiChat("gemini-3.5-flash", gwConfig(key)) as AnyTextAdapter,
	},
	{
		label: "grok/grok-4.3",
		model: "grok-4.3",
		key: process.env.GROK_API_KEY || process.env.XAI_API_KEY,
		make: (key) => createGrokChat("grok-4.3", gwConfig(key)) as AnyTextAdapter,
	},
	{
		label: "openrouter/openai/gpt-5.5",
		model: "openai/gpt-5.5",
		key: process.env.OPENROUTER_API_KEY,
		make: (key) => createOpenRouterChat("openai/gpt-5.5", gwConfig(key)) as AnyTextAdapter,
	},
];

// ---------------------------------------------------------------------------
// Results tracker
// ---------------------------------------------------------------------------

type Status = "ok" | "skip" | "fail";
const results: Record<string, { chat: Status; stream: Status; note: string }> = {};
function track(label: string) {
	if (!results[label]) results[label] = { chat: "skip", stream: "skip", note: "" };
	return results[label]!;
}

function printSummary() {
	const labels = Object.keys(results);
	if (labels.length === 0) return;
	const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
	const maxLabel = Math.max(...labels.map((l) => l.length), 8);
	const icon = (s: Status) => (s === "ok" ? " OK " : s === "skip" ? " -- " : "  X ");
	console.log(`\n${"-".repeat(maxLabel + 30)}`);
	console.log("  THIRD-PARTY GATEWAY ADAPTERS — E2E");
	console.log("-".repeat(maxLabel + 30));
	console.log(`${pad("Provider", maxLabel)} | Chat | Strm | Notes`);
	for (const l of labels) {
		const r = results[l]!;
		console.log(`${pad(l, maxLabel)} | ${icon(r.chat)} | ${icon(r.stream)} | ${r.note}`);
	}
	console.log("-".repeat(maxLabel + 30));
}

const USER_MESSAGE = [{ role: "user" as const, content: "Say hello in one short sentence." }];

describe.skipIf(noGatewayCreds())("Third-party gateway adapters E2E", () => {
	afterAll(() => printSummary());

	describe("chat — non-streaming (per provider)", () => {
		for (const p of PROVIDERS) {
			it(`${p.label} — chat via gateway`, async (ctx) => {
				const r = track(p.label);
				if (!p.key) {
					r.note = "no api key";
					return ctx.skip(`no api key for ${p.label}`);
				}

				const adapter = p.make(p.key);
				const text = await chat({
					adapter,
					stream: false,
					conversationId: crypto.randomUUID(),
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simple message shape matches at runtime
					messages: USER_MESSAGE as any,
				});

				expect(typeof text).toBe("string");
				expect((text as string).length).toBeGreaterThan(0);
				r.chat = "ok";
			});
		}
	});

	describe("chat — streaming (per provider)", () => {
		for (const p of PROVIDERS) {
			it(`${p.label} — streaming via gateway`, async (ctx) => {
				const r = track(p.label);
				if (!p.key) {
					r.note = "no api key";
					return ctx.skip(`no api key for ${p.label}`);
				}

				const adapter = p.make(p.key);
				const stream = chat({
					adapter,
					stream: true,
					conversationId: crypto.randomUUID(),
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simple message shape matches at runtime
					messages: USER_MESSAGE as any,
				});

				let text = "";
				let sawError: string | null = null;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- AG-UI chunk union
				for await (const chunk of stream as AsyncIterable<any>) {
					if (
						chunk?.type === "TEXT_MESSAGE_CONTENT" &&
						typeof chunk.content === "string"
					) {
						text += chunk.content;
					} else if (chunk?.type === "RUN_ERROR") {
						sawError = chunk.error?.message ?? "unknown run error";
					}
				}

				if (sawError) throw new Error(`[${p.label}] stream RUN_ERROR: ${sawError}`);
				expect(text.length).toBeGreaterThan(0);
				r.stream = "ok";
			});
		}
	});
});
