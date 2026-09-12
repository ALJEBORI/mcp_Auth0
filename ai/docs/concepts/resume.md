# Resumable streaming

> **🚧 Coming soon.** Resumable streaming is **not generally available yet** —
> the AI Gateway resume backend is still rolling out. The API described here is
> in place so you can adopt it early, but treat resume as experimental and
> subject to change until the rollout completes.

Long streaming responses can drop mid-stream (transient network blips, edge
restarts). Resumable streaming recovers from these **transparently**: the stream
reconnects to AI Gateway's resume endpoint and continues from where it left off,
so the downstream parser never sees the break.

## How it works

When a request goes through the **run path** (`env.AI.run`), AI Gateway returns a
`cf-aig-run-id` header. The resumable-stream engine wraps the response body so
that, on any mid-stream reader error, it re-attaches to the run by id and resumes
delivery — up to a bounded number of attempts.

```
env.AI.run(...)  ──▶  cf-aig-run-id: run_abc
       │
       ▼ (mid-stream drop)
  reconnect to the gateway resume endpoint for run_abc
       │
       ▼
  continue the SSE stream — parser sees one continuous stream
```

## Where resume is available

| Path                                     | Resume?                                |
| ---------------------------------------- | -------------------------------------- |
| Run path (`env.AI.run`, unified catalog) | ✅ — `cf-aig-run-id` is emitted        |
| Gateway path (`env.AI.gateway().run`)    | ❌ — no run id                         |
| `@cf/*` Workers AI models                | ❌ — no run id (per the routing model) |
| REST API                                 | ❌ — resume requires the binding       |

Resume only works where the **direct `env.AI` binding** is available and the run
path returns a `cf-aig-run-id`. When resume is requested but unavailable, the
behavior is a no-op plus a warning — never a hard failure.

## Abort vs resume

Resume reconnects on reader errors, but an **intentional abort must never
auto-recover**. The engine is `AbortSignal`-aware: when you cancel via an
`AbortController`, the stream stops instead of re-fetching the gateway buffer.
Always thread your `signal` through so cancellation behaves correctly.

## Expiry policy

If the gateway's resume buffer has been evicted (a `404` on re-attach after a
drop), `onResumeExpired` controls the outcome:

- `"error"` (default) — surface a `GatewayDelegateError`.
- `"accept-partial"` — end the stream cleanly with whatever was delivered.

## Cross-invocation re-attach

Pair `onDispatch` (to capture the `runId`) with `onProgress` (the cumulative SSE
event offset) to persist `{ runId, eventOffset }` and re-attach to a run across
separate invocations. Throttle your own writes — `onProgress` can fire per chunk.

```ts
import { streamText } from "ai";

// First invocation: capture the run id + how far the stream got.
streamText({
	model: workersai("openai/gpt-5", {
		onDispatch: (info) => state.put("runId", info.runId),
		onProgress: (eventOffset) => state.put("eventOffset", eventOffset), // throttle this
		onResumeExpired: "accept-partial", // tolerate the ~5.5 min buffer TTL
	}),
	prompt: "Write a long story.",
});
```

This is the pattern a Durable Object uses to survive eviction: store the run id
and offset as the stream advances, then re-attach to the same run after a
restart instead of re-billing a fresh generation.

## Usage

- **Vercel AI SDK:** the [`workers-ai-provider`](../workers-ai-provider/README.md)
  delegate enables resume by default on the run path; override per call with
  `resume: false` / `onResumeExpired`.

    ```ts
    workersai("openai/gpt-5"); // resume on (default)
    workersai("openai/gpt-5", { resume: false }); // opt out
    ```

- **TanStack AI:** the [`@cloudflare/tanstack-ai`](../tanstack-ai/README.md)
  Workers AI adapter accepts `resume` / `onResumeExpired` and dispatches catalog
  models through the run path so they are resumable.

    ```ts
    createWorkersAiChat("openai/gpt-5", {
    	binding: env.AI,
    	gateway: "my-gateway",
    	resume: true, // default
    });
    ```
