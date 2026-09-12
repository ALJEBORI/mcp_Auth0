/**
 * `ai-gateway-provider`'s URL→provider lookup table.
 *
 * The canonical provider registry now lives in `@cloudflare/gateway-core` and is
 * shared with `workers-ai-provider` / `@cloudflare/tanstack-ai`. This module
 * derives the legacy `{ name, regex, transformEndpoint, headerKey? }` shape that
 * `index.ts` consumes from that single source of truth, so there's only one place
 * that knows how to map a provider host to its gateway endpoint.
 *
 * Two things are intentionally preserved here:
 *  - the `compat` entry (the unified `/v1/compat/` surface) has no core
 *    equivalent, so it stays local and is appended last; and
 *  - `headerKey` is only emitted for providers whose native BYOK header is not
 *    `authorization` (matching the historical table, where `index.ts` defaults to
 *    stripping `authorization`).
 */
import { GATEWAY_PROVIDERS } from "@cloudflare/gateway-core";

export interface AiGatewayProviderConfig {
	name: string;
	regex: RegExp;
	transformEndpoint: (url: string) => string;
	headerKey?: string;
}

const derived: AiGatewayProviderConfig[] = GATEWAY_PROVIDERS.flatMap((p) => {
	// Only providers with a detectable host shape participate in URL routing.
	if (!p.hostPattern || !p.transformEndpoint) return [];
	const nativeAuthHeader = p.authHeaders[0];
	return [
		{
			name: p.gatewayProviderId,
			regex: p.hostPattern,
			transformEndpoint: p.transformEndpoint,
			...(nativeAuthHeader && nativeAuthHeader !== "authorization"
				? { headerKey: nativeAuthHeader }
				: {}),
		},
	];
});

export const providers: AiGatewayProviderConfig[] = [
	...derived,
	{
		name: "compat",
		regex: /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/compat\//,
		transformEndpoint: (url: string) =>
			url.replace(/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/compat\//, ""),
	},
];
