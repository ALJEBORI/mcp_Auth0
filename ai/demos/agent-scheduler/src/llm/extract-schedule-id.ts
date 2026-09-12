import type { Schedule } from "agents";
import { generateText, Output, type LanguageModel } from "ai";
import z from "zod";

export async function extractScheduleId(
	model: LanguageModel,
	query: string,
	schedules: Schedule[],
) {
	const { output: object } = await generateText({
		model,
		prompt: `
			You are an intelligent schedule manager. The user requested cancelling a schedule.
			Try to figure out which schedule ID from the list below is the best match.

			Prompt: "${query}"

			Current schedules: ${JSON.stringify(schedules)}

			Respond with a JSON object of the form:

			- if you find a match:
			{ "scheduleId": "[id]" }

			- if not:
			{ "scheduleId": undefined }
        `,
		output: Output.object({
			schema: z.object({
				scheduleId: z.string().optional(),
			}),
		}),
	});

	return object.scheduleId;
}
