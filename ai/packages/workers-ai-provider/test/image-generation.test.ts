import { APICallError } from "@ai-sdk/provider";
import { generateImage } from "ai";
import { describe, expect, it } from "vitest";
import { createWorkersAI } from "../src/index";

describe("Image Generation - Binding", () => {
	it("should generate a single image", async () => {
		const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header stub

		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(imageData);
							controller.close();
						},
					});
				},
			},
		});

		const result = await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A beautiful sunset",
			size: "512x512",
		});

		expect(result.images).toHaveLength(1);
		expect(result.images[0].uint8Array).toEqual(imageData);
	});

	it("should pass dimensions from size string", async () => {
		let capturedInputs: any = null;
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, inputs: any) => {
					capturedInputs = inputs;
					return new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1]));
							controller.close();
						},
					});
				},
			},
		});

		await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A dog",
			size: "1024x768",
			seed: 42,
		});

		expect(capturedInputs.width).toBe(1024);
		expect(capturedInputs.height).toBe(768);
		expect(capturedInputs.seed).toBe(42);
		expect(capturedInputs.prompt).toBe("A dog");
	});

	it("should handle undefined size gracefully", async () => {
		let capturedInputs: any = null;
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, inputs: any) => {
					capturedInputs = inputs;
					return new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1]));
							controller.close();
						},
					});
				},
			},
		});

		await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A tree",
		});

		expect(capturedInputs.width).toBeUndefined();
		expect(capturedInputs.height).toBeUndefined();
	});

	it("should handle Uint8Array output from binding", async () => {
		const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

		const workersai = createWorkersAI({
			binding: {
				run: async () => imageData,
			},
		});

		const result = await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A cat",
		});

		expect(result.images).toHaveLength(1);
		expect(result.images[0].uint8Array).toEqual(imageData);
	});

	it("should handle ArrayBuffer output from binding", async () => {
		const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

		const workersai = createWorkersAI({
			binding: {
				run: async () => imageData.buffer,
			},
		});

		const result = await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A cat",
		});

		expect(result.images).toHaveLength(1);
		expect(result.images[0].uint8Array).toEqual(imageData);
	});

	it("should handle Response output from binding", async () => {
		const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

		const workersai = createWorkersAI({
			binding: {
				run: async () => new Response(imageData),
			},
		});

		const result = await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A cat",
		});

		expect(result.images).toHaveLength(1);
		expect(result.images[0].uint8Array).toEqual(imageData);
	});

	it("should handle { image: base64 } object output from binding", async () => {
		const imageData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
		const base64 = btoa(String.fromCharCode(...imageData));

		const workersai = createWorkersAI({
			binding: {
				run: async () => ({ image: base64 }),
			},
		});

		const result = await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A cat",
		});

		expect(result.images).toHaveLength(1);
		expect(result.images[0].uint8Array).toEqual(imageData);
	});

	it("should throw descriptive error for unexpected output type", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => ({ unexpected: "data" }),
			},
		});

		await expect(
			generateImage({
				model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
				prompt: "A cat",
			}),
		).rejects.toThrow("Unexpected output type from image model");
	});

	it("normalizes an out-of-capacity binding error to a retryable 429 APICallError", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					throw new Error("3040: Capacity temporarily exceeded, please try again.");
				},
			} as any,
		});

		const err = await generateImage({
			model: workersai.image("@cf/black-forest-labs/flux-1-schnell"),
			prompt: "A cat",
			maxRetries: 0,
		}).catch((e) => e);

		expect(APICallError.isInstance(err)).toBe(true);
		expect((err as APICallError).statusCode).toBe(429);
		expect((err as APICallError).isRetryable).toBe(true);
	});
});
