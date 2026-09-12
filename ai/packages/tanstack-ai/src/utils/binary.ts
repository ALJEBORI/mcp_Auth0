/**
 * Shared binary-data utilities for Workers AI adapters.
 *
 * Workers AI returns binary data (images, audio) in various formats —
 * Uint8Array, ArrayBuffer, ReadableStream, or JSON objects with a base64 field.
 * These helpers normalise everything into base64 strings for the TanStack AI
 * result types.
 */

/**
 * Convert a Uint8Array to a base64 string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary);
}

/**
 * Collect all chunks from a ReadableStream<Uint8Array> into a single Uint8Array.
 */
export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	return combined;
}

/**
 * Normalise a Workers AI binary response to a base64 string.
 *
 * Handles:
 * - `Uint8Array` / `ArrayBuffer` — raw bytes
 * - `ReadableStream<Uint8Array>` — streamed bytes
 * - `{ [binaryKey]: "base64..." }` — JSON wrapper (e.g. `{ image: "..." }`)
 *
 * @param result  The raw value returned from Workers AI
 * @param binaryKey  The JSON field to look for when the result is an object
 *                   (defaults to `"image"`; pass `"audio"` for TTS responses)
 */
export async function binaryToBase64(
	result: unknown,
	binaryKey: string = "image",
): Promise<string> {
	if (result instanceof ReadableStream) {
		return uint8ArrayToBase64(await collectStream(result));
	}

	if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
		const bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : result;
		return uint8ArrayToBase64(bytes);
	}

	// Some models return { image: "base64..." } or { audio: "base64..." }
	if (typeof result === "object" && result !== null && binaryKey in result) {
		return (result as Record<string, string>)[binaryKey]!;
	}

	throw new Error(
		`Unexpected binary response format from Workers AI (expected Uint8Array, ArrayBuffer, ReadableStream, or { ${binaryKey}: string })`,
	);
}
