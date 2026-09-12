# Gateway routing

All three packages route requests through Cloudflare AI Gateway using one shared
provider registry. This page explains how a `vendor/model` slug becomes an actual
upstream request.

## The two transports

|                                | Run path                                                      | Gateway path                           |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------- |
| Call                           | `env.AI.run("<vendor>/<model>", …)`                           | `env.AI.gateway(id).run([entry, …])`   |
| Billing                        | Unified (Cloudflare-billed)                                   | Unified or BYOK                        |
| Auth                           | Cloudflare account                                            | Gateway stored key, or your key (BYOK) |
| Resume _(coming soon)_         | ✅ emits `cf-aig-run-id`                                      | ❌                                     |
| Caching / server-side fallback | ❌                                                            | ✅                                     |
| Wire format                    | Cloudflare-normalized (mostly OpenAI; Anthropic stays native) | Provider-native                        |

The **run path** is the default for unified-billing catalog providers because it
is the only path that supports [resumable streaming](./resume.md) (a
**coming-soon** capability — see that page). The **gateway
path** is used when you ask for a gateway-only feature (caching, server-side
fallback, `transport: "gateway"`) or for BYOK providers that are not on the run
catalog.

```ts
import { createWorkersAI } from "workers-ai-provider";
import { openai } from "workers-ai-provider/openai";
import { streamText } from "ai";

const workersai = createWorkersAI({ binding: env.AI, providers: [openai] });

// Run path (default): unified billing + resume, no extra options.
streamText({ model: workersai("openai/gpt-5"), prompt: "Hi" });

// Gateway path: requesting caching forces it (and disables resume).
streamText({ model: workersai("openai/gpt-5", { cacheTtl: 3600 }), prompt: "Hi" });

// Force a transport explicitly.
streamText({ model: workersai("openai/gpt-5", { transport: "gateway" }), prompt: "Hi" });
```

## Transport selection

The delegate picks a transport from the registry entry + your options:

1. **Run-catalog provider, no gateway-only feature** → run path (resume on).
2. **Caching, `fallback.mode: "server"`, or `transport: "gateway"`** → gateway
   path. Resume is disabled — if you also passed `resume: true` explicitly, this
   is an error; if resume was merely the default, you get a warning.
3. **BYOK provider** (not on the run catalog) → gateway path only.
4. **Run-only provider** (on the unified catalog but with no native gateway path,
   e.g. `alibaba`, `minimax`) → run path only; caching / server fallback /
   `transport: "gateway"` are rejected with a clear error.

## Provider registry

The registry maps a slug prefix (`resolverKey`) to:

- `gatewayProviderId` — the id used on the gateway universal endpoint.
- `wireFormat` — the built-in `@ai-sdk` parser (`openai` covers the whole
  OpenAI-compatible long tail: deepseek, grok, groq, mistral, perplexity, …).
- `runWireFormat` — what the unified run path actually returns (defaults to
  `openai`; Anthropic is passed through natively).
- `runCatalog` / `gatewayPath` / `billing` / `authHeaders` — capability flags.
- `hostPattern` / `transformEndpoint` — for bring-your-own-provider URL mapping.

Aliases are resolved too — e.g. `grok` → `xai`, `bedrock` → `aws-bedrock`.

## Server-side fallback

`fallback: { mode: "server", models: [...] }` ships every leg in **one**
`env.AI.gateway(id).run([...])` call; the gateway tries them in order and returns
`cf-aig-step` naming the leg it actually served.

- **Same-vendor** legs are the primary entry with `model` swapped.
- **Cross-vendor** legs (different wire formats) are captured individually: each
  leg's own model builder shapes its native request (a sentinel-throw stops it
  before the network), all legs are reshaped into gateway entries and dispatched
  as one run, then the winner's raw response is fed back into its own parser.

For **client-side** fallback (`mode: "client"`) the delegate builds one model per
leg and falls through sequentially on a failed pre-stream dispatch — each leg
keeps its own transport, so resume is preserved per leg.

See [`workers-ai-provider`](../workers-ai-provider/README.md) for the delegate
API and [resume](./resume.md) for the interaction with resumable streaming.
