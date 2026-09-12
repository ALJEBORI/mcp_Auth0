# @cloudflare/tanstack-ai demo

Multi-provider AI demo showcasing [`@cloudflare/tanstack-ai`](../../packages/tanstack-ai). Features **Chat**, **Image Generation**, and **Summarization** across Workers AI and third-party providers (OpenAI, Anthropic, Gemini, Grok) through Cloudflare AI Gateway.

## Features

### Chat

| Provider             | Model                        | Config Mode               |
| -------------------- | ---------------------------- | ------------------------- |
| **GLM 5.2**          | `@cf/zai-org/glm-5.2`        | Workers AI direct         |
| **Qwen3 30B**        | `@cf/qwen/qwen3-30b-a3b-fp8` | Workers AI via AI Gateway |
| **GPT-5.5**          | `gpt-5.5`                    | OpenAI via AI Gateway     |
| **Claude Opus 4.8**  | `claude-opus-4.8`            | Anthropic via AI Gateway  |
| **Gemini 3.5 Flash** | `gemini-3.5-flash`           | Gemini via AI Gateway     |
| **Grok 4.3**         | `grok-4.3`                   | Grok via AI Gateway       |

### Image Generation

| Provider   | Model                            |
| ---------- | -------------------------------- |
| **OpenAI** | `gpt-image-2`                    |
| **Gemini** | `gemini-3.1-flash-image-preview` |
| **Grok**   | `grok-imagine-image`             |

### Summarization

| Provider       | Model                         |
| -------------- | ----------------------------- |
| **Workers AI** | `@cf/facebook/bart-large-cnn` |
| **OpenAI**     | `gpt-5.5`                     |
| **Anthropic**  | `claude-opus-4.8`             |
| **Gemini**     | `gemini-3.5-flash`            |

## Setup

### Option 1: Enter credentials in the UI (recommended for trying it out)

1. Install and run:

```bash
pnpm install
pnpm dev
```

2. Click **"Add API keys"** in the top-right corner and enter your Cloudflare Account ID, AI Gateway ID, and API Token. Credentials are stored in your browser's localStorage and sent as request headers -- never persisted on the server.

### Option 2: Use environment variables (recommended for deploying)

1. Copy the environment variables template:

```bash
cp .dev.vars.example .dev.vars
```

2. Fill in your `.dev.vars`:

```
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_AI_GATEWAY_ID=your-ai-gateway-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
```

3. Install and run:

```bash
pnpm install
pnpm dev
```

> When both are present, user-provided credentials (from the UI) take precedence over environment variables.

## What It Demonstrates

- **Workers AI direct** -- `createWorkersAiChat(model, { binding: env.AI })` or REST API with `{ accountId, apiKey }`
- **Workers AI through AI Gateway** -- `createWorkersAiChat(model, { binding: env.AI.gateway(id) })` or credentials mode
- **Third-party providers through AI Gateway** -- `createOpenAiChat`, `createAnthropicChat`, `createGeminiChat`, `createGrokChat`
- **Image generation** -- `generateImage()` with `createOpenAiImage`, `createGeminiImage`, `createGrokImage`
- **Summarization** -- `summarize()` with `createOpenAiSummarize`, `createAnthropicSummarize`, `createGeminiSummarize`
- **Streaming** -- chat providers stream responses via TanStack AI's `chat()` + `toHttpResponse()`
- **Tool calling** -- server-side tools (math, time, web scrape) work across all chat providers
- **Dynamic credentials** -- user-provided API keys passed via request headers, with env var fallback
