/**
 * Error type shared by the gateway delegate and the resumable-stream engine.
 *
 * Lives in `@cloudflare/gateway-core` because the resume engine (here) and the
 * delegate (in `workers-ai-provider`) both throw it. Note: since each consumer
 * inlines this source into its own bundle, `instanceof GatewayDelegateError`
 * only matches within a single package's bundle — match on `.name`/`.kind`
 * across package boundaries.
 */
export type GatewayDelegateErrorKind = "config" | "dispatch" | "provider" | "resume-expired";

export class GatewayDelegateError extends Error {
	readonly kind: GatewayDelegateErrorKind;
	override readonly cause?: unknown;

	constructor(kind: GatewayDelegateErrorKind, message: string, cause?: unknown) {
		super(message);
		this.name = "GatewayDelegateError";
		this.kind = kind;
		this.cause = cause;
	}
}
