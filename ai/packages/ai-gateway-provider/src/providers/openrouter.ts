import { createOpenRouter as createOpenRouterOriginal } from "@openrouter/ai-sdk-provider";
import { authWrapper } from "../auth";

export const createOpenRouter = (...args: Parameters<typeof createOpenRouterOriginal>) =>
	authWrapper(createOpenRouterOriginal)(...args);
