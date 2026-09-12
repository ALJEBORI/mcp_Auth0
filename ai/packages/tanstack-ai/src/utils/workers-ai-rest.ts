import type { WorkersAiDirectCredentialsConfig } from "./create-fetcher";
import { errorFromResponse } from "./errors";

/**
 * Workers AI REST API base URL.
 * All model endpoints follow the pattern: `${BASE_URL}/${accountId}/ai/run/${model}`
 */
const WORKERS_AI_REST_BASE = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Make a REST API call to Workers AI.
 *
 * Handles the common pattern shared by all Workers AI adapters:
 * - Build the URL from account ID and model name
 * - Set Authorization and Content-Type headers
 * - Check response.ok and throw a descriptive error on failure
 *
 * @param config  Credentials config with accountId and apiKey
 * @param model   Workers AI model name (e.g. "@cf/stabilityai/stable-diffusion-xl-base-1.0")
 * @param body    JSON request body
 * @param options Optional settings:
 *   - `label`  — human-readable label for error messages (default: "Workers AI")
 *   - `signal` — AbortSignal for request cancellation / timeout
 * @returns The raw Response object — caller is responsible for parsing
 */
export async function workersAiRestFetch(
	config: WorkersAiDirectCredentialsConfig,
	model: string,
	body: Record<string, unknown>,
	options?: { label?: string; signal?: AbortSignal },
): Promise<Response> {
	const response = await fetch(`${WORKERS_AI_REST_BASE}/${config.accountId}/ai/run/${model}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: options?.signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		const label = options?.label ?? "Workers AI";
		throw errorFromResponse(response, errorText, label);
	}

	return response;
}

/**
 * Make a binary REST API call to Workers AI.
 *
 * Some models (e.g. `@cf/deepgram/nova-3`) require raw binary audio with an
 * appropriate `Content-Type` header instead of JSON. This function sends the
 * audio bytes directly as the request body.
 *
 * @param config  Credentials config with accountId and apiKey
 * @param model   Workers AI model name
 * @param audioBytes  Raw audio bytes
 * @param contentType  MIME type of the audio (e.g. "audio/wav")
 * @param options Optional settings
 * @returns The raw Response object
 */
export async function workersAiRestFetchBinary(
	config: WorkersAiDirectCredentialsConfig,
	model: string,
	audioBytes: Uint8Array,
	contentType: string,
	options?: { label?: string; signal?: AbortSignal },
): Promise<Response> {
	const response = await fetch(`${WORKERS_AI_REST_BASE}/${config.accountId}/ai/run/${model}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": contentType,
		},
		body: audioBytes,
		signal: options?.signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		const label = options?.label ?? "Workers AI";
		throw errorFromResponse(response, errorText, label);
	}

	return response;
}
