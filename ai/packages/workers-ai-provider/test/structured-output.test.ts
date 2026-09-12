import { generateObject, generateText, Output, streamText } from "ai";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { createWorkersAI } from "../src/index";

const TEST_ACCOUNT_ID = "test-account-id";
const TEST_API_KEY = "test-api-key";
const TEST_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const structuredOutputHandler = http.post(
	`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
	async () => {
		return HttpResponse.json({
			errors: [],
			messages: [],
			result: {
				response: JSON.stringify({
					recipe: {
						ingredients: [
							{ amount: "200g", name: "spaghetti" },
							{ amount: "300g", name: "minced beef" },
							{ amount: "500ml", name: "tomato sauce" },
							{ amount: "1 medium", name: "onion" },
							{ amount: "2 cloves", name: "garlic" },
						],
						name: "Spaghetti Bolognese",
						steps: [
							"Cook spaghetti.",
							"Fry onion & garlic.",
							"Add minced beef.",
							"Simmer with sauce.",
							"Serve.",
						],
					},
				}),
			},
			success: true,
		});
	},
);

const server = setupServer(structuredOutputHandler);

const recipeSchema = z.object({
	recipe: z.object({
		ingredients: z.array(z.object({ amount: z.string(), name: z.string() })),
		name: z.string(),
		steps: z.array(z.string()),
	}),
});

describe("REST API - Structured Output Tests", () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it("should generate structured output with schema (non-streaming)", async () => {
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = await generateText({
			model: workersai(TEST_MODEL),
			prompt: "Give me a Spaghetti Bolognese recipe",
			output: Output.object({ schema: recipeSchema }),
		});

		const object = result.output;
		expect(object?.recipe.name).toBe("Spaghetti Bolognese");
		expect(object?.recipe.ingredients.length).toBeGreaterThan(0);
		expect(object?.recipe.steps.length).toBeGreaterThan(0);
	});
});

describe("Binding - Structured Output Tests", () => {
	it("should generate structured output with schema (non-streaming)", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, _inputs: any, _options?: any) => {
					return {
						response: {
							recipe: {
								ingredients: [
									{ amount: "200g", name: "spaghetti" },
									{ amount: "300g", name: "minced beef" },
									{ amount: "500ml", name: "tomato sauce" },
									{ amount: "1 medium", name: "onion" },
									{ amount: "2 cloves", name: "garlic" },
								],
								name: "Spaghetti Bolognese",
								steps: [
									"Cook spaghetti.",
									"Fry onion & garlic.",
									"Add minced beef.",
									"Simmer with sauce.",
									"Serve.",
								],
							},
						},
					};
				},
			},
		});

		const result = await generateText({
			model: workersai(TEST_MODEL),
			prompt: "Give me a Spaghetti Bolognese recipe",
			output: Output.object({ schema: recipeSchema }),
		});

		const object = result.output;
		expect(object?.recipe.name).toBe("Spaghetti Bolognese");
		expect(object?.recipe.ingredients.length).toBeGreaterThan(0);
		expect(object?.recipe.steps.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Wire-payload shape for native models (issue #559)
//
// Native Workers AI expects a BARE JSON Schema under `response_format.
// json_schema` (not OpenAI's `{ name, schema, strict }` envelope). The AI SDK's
// `name`/`description` must be preserved as JSON Schema `title`/`description`
// rather than dropped. Partner models (e.g. `openai/...`) take a different
// route (the gateway delegate) and are not exercised here.
// ---------------------------------------------------------------------------

const simpleSchema = z.object({ ok: z.boolean() });

/** Capture the JSON body of the next request to the Workers AI run endpoint. */
function captureRestBody(): { get: () => any } {
	let body: any;
	server.use(
		http.post(
			`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
			async ({ request }) => {
				body = await request.json();
				return HttpResponse.json({
					result: { response: JSON.stringify({ ok: true }) },
				});
			},
		),
	);
	return { get: () => body };
}

describe("REST API - response_format wire shape (issue #559)", () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it("sends a bare JSON Schema, not an OpenAI envelope", async () => {
		const captured = captureRestBody();
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		await generateText({
			model: workersai(TEST_MODEL),
			prompt: "Return ok",
			output: Output.object({ schema: simpleSchema }),
		});

		const rf = captured.get().response_format;
		expect(rf.type).toBe("json_schema");
		// Bare schema keywords are top-level on json_schema...
		expect(rf.json_schema.type).toBe("object");
		expect(rf.json_schema.properties).toHaveProperty("ok");
		// ...and the OpenAI envelope keys must NOT be present.
		expect(rf.json_schema).not.toHaveProperty("schema");
		expect(rf.json_schema).not.toHaveProperty("strict");
		expect(rf.json_schema).not.toHaveProperty("name");
	});

	it("folds Output.object name/description into title/description", async () => {
		const captured = captureRestBody();
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		await generateText({
			model: workersai(TEST_MODEL),
			prompt: "Return ok",
			output: Output.object({
				schema: simpleSchema,
				name: "Result",
				description: "A boolean result",
			}),
		});

		const jsonSchema = captured.get().response_format.json_schema;
		expect(jsonSchema.title).toBe("Result");
		expect(jsonSchema.description).toBe("A boolean result");
		// Still a bare schema.
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema).not.toHaveProperty("schema");
	});

	it("preserves the same shape on the streaming path", async () => {
		let body: any;
		server.use(
			http.post(
				`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
				async ({ request }) => {
					body = await request.json();
					return new Response(
						[`data: {"response":"{\\"ok\\":true}"}\n\n`, "data: [DONE]\n\n"].join(""),
						{
							headers: {
								"Content-Type": "text/event-stream",
								"Transfer-Encoding": "chunked",
							},
							status: 200,
						},
					);
				},
			),
		);

		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = streamText({
			model: workersai(TEST_MODEL),
			prompt: "Return ok",
			output: Output.object({ schema: simpleSchema, name: "Result" }),
		});
		for await (const _ of result.textStream) {
			// drain
		}

		const jsonSchema = body.response_format.json_schema;
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema.title).toBe("Result");
		expect(jsonSchema).not.toHaveProperty("schema");
	});
});

describe("generateObject - response_format wire shape (issue #559)", () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it("folds schemaName/schemaDescription into title/description", async () => {
		const captured = captureRestBody();
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = await generateObject({
			model: workersai(TEST_MODEL),
			schema: simpleSchema,
			schemaName: "Result",
			schemaDescription: "A boolean result",
			prompt: "Return ok",
		});

		expect(result.object).toEqual({ ok: true });
		const jsonSchema = captured.get().response_format.json_schema;
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema.title).toBe("Result");
		expect(jsonSchema.description).toBe("A boolean result");
		// Still a bare schema, not an OpenAI envelope.
		expect(jsonSchema).not.toHaveProperty("schema");
		expect(jsonSchema).not.toHaveProperty("strict");
	});

	it("sends a bare schema when no schemaName/description given", async () => {
		const captured = captureRestBody();
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = await generateObject({
			model: workersai(TEST_MODEL),
			schema: simpleSchema,
			prompt: "Return ok",
		});

		expect(result.object).toEqual({ ok: true });
		const jsonSchema = captured.get().response_format.json_schema;
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema.properties).toHaveProperty("ok");
		expect(jsonSchema).not.toHaveProperty("title");
		expect(jsonSchema).not.toHaveProperty("schema");
	});
});

describe("Binding - response_format wire shape (issue #559)", () => {
	it("sends a bare JSON Schema with folded title/description", async () => {
		let inputs: any;
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, capturedInputs: any) => {
					inputs = capturedInputs;
					return { response: JSON.stringify({ ok: true }) };
				},
			} as any,
		});

		await generateText({
			model: workersai(TEST_MODEL),
			prompt: "Return ok",
			output: Output.object({
				schema: simpleSchema,
				name: "Result",
				description: "A boolean result",
			}),
		});

		const rf = inputs.response_format;
		expect(rf.type).toBe("json_schema");
		expect(rf.json_schema.type).toBe("object");
		expect(rf.json_schema.title).toBe("Result");
		expect(rf.json_schema.description).toBe("A boolean result");
		expect(rf.json_schema).not.toHaveProperty("schema");
		expect(rf.json_schema).not.toHaveProperty("strict");
	});

	it("does not overwrite a description already present in the schema", async () => {
		let inputs: any;
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, capturedInputs: any) => {
					inputs = capturedInputs;
					return { response: JSON.stringify({ ok: true }) };
				},
			} as any,
		});

		// Top-level `.describe()` becomes the schema's `description`.
		const describedSchema = z.object({ ok: z.boolean() }).describe("Schema-level description");

		await generateText({
			model: workersai(TEST_MODEL),
			prompt: "Return ok",
			output: Output.object({
				schema: describedSchema,
				description: "Output-level description",
			}),
		});

		expect(inputs.response_format.json_schema.description).toBe("Schema-level description");
	});
});
