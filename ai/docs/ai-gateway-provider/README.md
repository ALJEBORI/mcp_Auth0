# ai-gateway-provider

`ai-gateway-provider` routes [Vercel AI SDK](https://sdk.vercel.ai/docs) models
through Cloudflare's [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
universal endpoint. You wrap pre-built `@ai-sdk/*` model instances and the
provider captures their outbound requests, re-dispatches them through the
gateway (binding or REST), and applies caching, retries, logging, and
cross-vendor server-side fallback.

It shares its provider registry and `cf-aig-*` header building with the
`workers-ai-provider` AI Gateway **delegate**, so the two stay in lockstep.

## Install

```bash
npm install ai-gateway-provider ai
```

Install only the `@ai-sdk/*` providers you actually wrap — they're optional peers:

```bash
npm install @ai-sdk/openai      # also covers the OpenAI-compatible long tail
npm install @ai-sdk/anthropic
```

## Quick start

Wrap a single pre-built model and route it through your gateway. Inside a Worker,
use the `env.AI.gateway(id)` binding; the rest of your AI SDK code is unchanged.

```ts
import { createAiGateway } from "ai-gateway-provider";
import { createOpenAI } from "ai-gateway-provider/providers/openai";
import { generateText } from "ai";

const aigateway = createAiGateway({ binding: env.AI.gateway("my-gateway") });
const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

const { text } = await generateText({
	model: aigateway([openai("gpt-5")]),
	prompt: "Write a haiku about Cloudflare Workers.",
});
```

Outside a Worker (Node, scripts, CI), use the REST path with your account id,
gateway id, and — if the gateway has authentication enabled — its token:

```ts
const aigateway = createAiGateway({
	accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
	gateway: "my-gateway",
	apiKey: process.env.CLOUDFLARE_AI_GATEWAY_TOKEN, // only if the gateway is authenticated
});
```

Streaming, structured output, and tools all work — they're just standard AI SDK
calls on the wrapped model:

```ts
import { generateObject, streamText } from "ai";
import { z } from "zod";

const model = aigateway([openai("gpt-5")]);

// Streaming
const result = streamText({ model, prompt: "Tell me a story." });
for await (const chunk of result.textStream) process.stdout.write(chunk);

// Structured output
const { object } = await generateObject({
	model,
	prompt: "Describe France.",
	schema: z.object({ capital: z.string(), populationMillions: z.number() }),
});
```

## When to use this vs. the `workers-ai-provider` delegate

Both reach the same AI Gateway. Pick based on how you construct models:

| You want…                                                             | Use                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| To wrap **pre-built `@ai-sdk/*` model instances** behind the gateway  | `ai-gateway-provider` (`createAiGateway`)                                                               |
| `vendor/model` **slugs** + provider plugins + the unified run catalog | [`workers-ai-provider`](../../packages/workers-ai-provider) delegate (`createWorkersAI({ providers })`) |

Both support **resumable streaming** _(coming soon)_ on the binding/run path
(`cf-aig-run-id`): the delegate enables it by default, while `ai-gateway-provider`
exposes it as an opt-in `resume` setting (see below).

## Cross-vendor fallback

Pass multiple models; the gateway tries them in order and the first success
wins (selected via the `cf-aig-step` response header):

```ts
import { createAiGateway } from "ai-gateway-provider";
import { createOpenAI } from "ai-gateway-provider/providers/openai";
import { createAnthropic } from "ai-gateway-provider/providers/anthropic";

const aigateway = createAiGateway({ binding: env.AI.gateway("my-gateway") });
const openai = createOpenAI({ apiKey: OPENAI_API_KEY });
const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY });

const model = aigateway([
	openai.chat("gpt-5"),
	anthropic("claude-sonnet-4-5"), // cross-vendor fallback
]);
```

## Request options & `cf-aig-*` headers

`options` on `createAiGateway` map to the current `cf-aig-*` request headers:

| Option             | Header                                                          |
| ------------------ | --------------------------------------------------------------- |
| `cacheTtl`         | `cf-aig-cache-ttl`                                              |
| `skipCache`        | `cf-aig-skip-cache`                                             |
| `cacheKey`         | `cf-aig-cache-key`                                              |
| `metadata`         | `cf-aig-metadata`                                               |
| `collectLog`       | `cf-aig-collect-log`                                            |
| `eventId`          | `cf-aig-event-id`                                               |
| `requestTimeoutMs` | `cf-aig-request-timeout`                                        |
| `retries`          | `cf-aig-max-attempts` / `cf-aig-retry-delay` / `cf-aig-backoff` |
| `byokAlias`        | `cf-aig-byok-alias`                                             |
| `zdr`              | `cf-aig-zdr`                                                    |

The deprecated `cf-cache-ttl` / `cf-skip-cache` names are no longer emitted.

Set them once on the provider and they apply to every request:

```ts
const aigateway = createAiGateway({
	binding: env.AI.gateway("my-gateway"),
	options: {
		cacheTtl: 3600, // cache responses for an hour
		metadata: { team: "search", userId: 12345 }, // spend attribution in the dashboard
	},
});
```

## Resumable streaming (opt-in)

> **🚧 Coming soon.** Resumable streaming is not generally available yet — the
> AI Gateway resume backend is still rolling out. The `resume` option below is in
> place so you can adopt it early, but treat resume as experimental until the
> rollout completes.

On the binding (run) path, pass `resume` with the full `env.AI` binding and the
gateway id to recover transient mid-stream drops via the gateway resume endpoint:

```ts
const aigateway = createAiGateway({
	binding: env.AI.gateway("my-gateway"),
	resume: { binding: env.AI, gateway: "my-gateway" }, // onResumeExpired?: "error" | "accept-partial"
});
```

It uses the same resumable-stream engine as the `workers-ai-provider` delegate.
Resume is a no-op when no `cf-aig-run-id` is present — e.g. the REST/API-key
transport or non-streaming calls.

See [gateway routing](../concepts/gateway-routing.md) for the full transport and
fallback model.
