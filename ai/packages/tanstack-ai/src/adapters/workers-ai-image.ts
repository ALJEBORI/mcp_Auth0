import { BaseImageAdapter } from "@tanstack/ai/adapters";
import { resolveMediaPrompt } from "@tanstack/ai";
import type { ImageGenerationOptions, ImageGenerationResult } from "@tanstack/ai";
import type { AiModels, BaseAiTextToImage } from "@cloudflare/workers-types";
import {
	type WorkersAiAdapterConfig,
	type WorkersAiDirectBindingConfig,
	type AiGatewayAdapterConfig,
	createGatewayFetch,
	isDirectBindingConfig,
	isDirectCredentialsConfig,
	validateWorkersAiConfig,
} from "../utils/create-fetcher";
import { workersAiRestFetch } from "../utils/workers-ai-rest";
import { binaryToBase64, uint8ArrayToBase64 } from "../utils/binary";
import { errorFromResponse, normalizeBindingError, withWorkersAiRetry } from "../utils/errors";
import type { WorkersAiDirectCredentialsConfig } from "../utils/create-fetcher";

// ---------------------------------------------------------------------------
// Model type derived from @cloudflare/workers-types
// ---------------------------------------------------------------------------

export type WorkersAiImageModel =
	| {
			[K in keyof AiModels]: AiModels[K] extends BaseAiTextToImage ? K : never;
	  }[keyof AiModels]
	| (string & {});

// ---------------------------------------------------------------------------
// WorkersAiImageAdapter: image generation via Workers AI
// Extends BaseImageAdapter so it works with TanStack AI's generateImage()
// ---------------------------------------------------------------------------

export class WorkersAiImageAdapter extends BaseImageAdapter<WorkersAiImageModel> {
	readonly name = "workers-ai-image" as const;
	private adapterConfig: WorkersAiAdapterConfig;

	constructor(config: WorkersAiAdapterConfig, model: WorkersAiImageModel) {
		super(model);
		validateWorkersAiConfig(config);
		this.adapterConfig = config;
	}

	async generateImages(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
		const { prompt, size, modelOptions } = options;
		const extra: Record<string, unknown> = { ...modelOptions };

		// Note: Workers AI Stable Diffusion models only generate a single image
		// per request — there is no multi-image parameter. `numberOfImages` from
		// the TanStack AI options is intentionally not forwarded. Use
		// `modelOptions.num_steps` to control the number of diffusion steps.

		if (size) {
			const [w, h] = size.split("x");
			if (w) extra.width = Number(w);
			if (h) extra.height = Number(h);
		}

		// TanStack AI's `prompt` is a multimodal `MediaPrompt`
		// (`string | MediaPromptPart[]`). Workers AI text-to-image models only
		// accept a text prompt, so use the SDK's `resolveMediaPrompt` to flatten
		// it down to its verbatim text (media parts are dropped).
		const promptText = resolveMediaPrompt(prompt).text;

		return withWorkersAiRetry(
			() => {
				if (isDirectBindingConfig(this.adapterConfig)) {
					return this.generateViaBinding(promptText, extra);
				}

				if (isDirectCredentialsConfig(this.adapterConfig)) {
					return this.generateViaRest(promptText, extra);
				}

				// Gateway mode
				return this.generateViaGateway(promptText, extra);
			},
			{ maxRetries: this.adapterConfig.maxRetries },
		);
	}

	private async generateViaBinding(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<ImageGenerationResult> {
		const ai = (this.adapterConfig as WorkersAiDirectBindingConfig).binding;
		let result: unknown;
		try {
			result = await ai.run(this.model, { prompt, ...options });
		} catch (error) {
			throw normalizeBindingError(error, "Workers AI image");
		}

		const b64 = await binaryToBase64(result, "image");
		return this.wrapResult(b64);
	}

	private async generateViaRest(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<ImageGenerationResult> {
		const config = this.adapterConfig as WorkersAiDirectCredentialsConfig;
		const response = await workersAiRestFetch(
			config,
			this.model,
			{ prompt, ...options },
			{
				label: "Workers AI image",
				signal: (options as { signal?: AbortSignal }).signal,
			},
		);

		const buffer = await response.arrayBuffer();
		return this.wrapResult(uint8ArrayToBase64(new Uint8Array(buffer)));
	}

	private async generateViaGateway(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<ImageGenerationResult> {
		const gatewayConfig = this.adapterConfig as AiGatewayAdapterConfig;
		const gatewayFetch = createGatewayFetch("workers-ai", gatewayConfig);

		// The URL here is a placeholder — createGatewayFetch for "workers-ai" extracts
		// the model from the body, sets it as the endpoint, and routes through the gateway.
		// The actual URL path is not used.
		const response = await gatewayFetch("https://api.cloudflare.com/v1/images/generations", {
			method: "POST",
			body: JSON.stringify({
				model: this.model,
				prompt,
				...options,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw errorFromResponse(response, errorText, "Workers AI image gateway");
		}

		const buffer = await response.arrayBuffer();
		return this.wrapResult(uint8ArrayToBase64(new Uint8Array(buffer)));
	}

	/** Wrap a base64 image string into the standard ImageGenerationResult. */
	private wrapResult(b64: string): ImageGenerationResult {
		return {
			id: this.generateId(),
			model: this.model,
			images: [{ b64Json: b64 }],
		};
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Creates a Workers AI image generation adapter.
 *
 * Works with TanStack AI's `generateImage()` activity function:
 * ```ts
 * import { generateImage } from "@tanstack/ai";
 * import { createWorkersAiImage } from "@cloudflare/tanstack-ai";
 *
 * const adapter = createWorkersAiImage(
 *   "@cf/stabilityai/stable-diffusion-xl-base-1.0",
 *   { binding: env.AI },
 * );
 *
 * const result = await generateImage({ adapter, prompt: "a cat in space" });
 * ```
 *
 * Note: Factory takes `(model, config)` for ergonomics — the class constructor
 * uses `(config, model)` to match TanStack AI's upstream convention.
 */
export function createWorkersAiImage(model: WorkersAiImageModel, config: WorkersAiAdapterConfig) {
	return new WorkersAiImageAdapter(config, model);
}
