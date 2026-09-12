/**
 * TanStack AI example app — interactive demo of @cloudflare/tanstack-ai
 * across multiple providers (Workers AI, OpenAI, Anthropic, Gemini, Grok,
 * OpenRouter). Each provider card shows its supported capabilities.
 * The worker backend is in worker/index.ts.
 */
import { useState } from "react";
import { ProviderView } from "./ProviderView";
import { ConfigProvider, useConfig } from "./config";
import { PROVIDERS } from "./providers";

function AppContent() {
	const [activeProviderId, setActiveProviderId] = useState(PROVIDERS[0]!.id);
	const [showSettings, setShowSettings] = useState(false);
	const {
		config,
		setCloudflare,
		setProviderKey,
		setUseBinding,
		clearAll,
		isCloudflareConfigured,
		hasAnyProviderKey,
	} = useConfig();
	const isConfigured = config.useBinding || isCloudflareConfigured || hasAnyProviderKey;

	const activeProvider = PROVIDERS.find((p) => p.id === activeProviderId) ?? PROVIDERS[0]!;

	return (
		<div className="size-full flex flex-col bg-gray-50">
			<div className="max-w-4xl w-full mx-auto flex flex-col h-full">
				{/* Header */}
				<header className="px-4 sm:px-6 pt-4 sm:pt-6 pb-0 bg-white">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2.5">
							<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
								<svg
									className="w-4 h-4 text-white"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={2.5}
								>
									<title>Logo</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
									/>
								</svg>
							</div>
							<div>
								<h1 className="text-base font-semibold text-gray-900">
									@cloudflare/tanstack-ai
								</h1>
								<p className="text-xs text-gray-500">Multi-provider AI demo</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setShowSettings((s) => !s)}
							className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
								isConfigured
									? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
									: "text-amber-700 bg-amber-50 hover:bg-amber-100"
							}`}
						>
							<svg
								className="w-3.5 h-3.5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<title>Settings</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
								/>
							</svg>
							{isConfigured ? "Configured" : "Add API keys"}
						</button>
					</div>

					{/* Settings panel (collapsible) */}
					{showSettings && (
						<div className="mb-4 space-y-3">
							{/* Connection mode toggle */}
							<div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
								<div className="flex items-center justify-between">
									<div>
										<p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
											Connection Mode
										</p>
										<p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
											{config.useBinding
												? "Using env.AI binding directly. Works in local dev (wrangler) and deployed Workers."
												: "Using REST credentials to connect to AI Gateway."}
										</p>
									</div>
									<div className="flex items-center gap-2 ml-4 shrink-0">
										<span
											className={`text-[10px] font-medium ${config.useBinding ? "text-gray-400" : "text-gray-700"}`}
										>
											REST
										</span>
										<button
											type="button"
											role="switch"
											aria-checked={config.useBinding}
											onClick={() => setUseBinding(!config.useBinding)}
											className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 ${
												config.useBinding ? "bg-emerald-500" : "bg-gray-300"
											}`}
										>
											<span
												className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
													config.useBinding
														? "translate-x-4"
														: "translate-x-0"
												}`}
											/>
										</button>
										<span
											className={`text-[10px] font-medium ${config.useBinding ? "text-gray-700" : "text-gray-400"}`}
										>
											Binding
										</span>
									</div>
								</div>
							</div>

							{/* Provider API Keys */}
							<div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
								<div className="flex items-center justify-between mb-3">
									<p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
										Provider API Keys
									</p>
									{(hasAnyProviderKey || isCloudflareConfigured) && (
										<button
											type="button"
											onClick={clearAll}
											className="text-[10px] text-red-500 hover:text-red-700 font-medium"
										>
											Clear all
										</button>
									)}
								</div>
								<p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
									Optional if your AI Gateway has provider keys configured via
									BYOK. Otherwise, enter keys for the providers you want to test.
									Keys are stored in your browser only.
								</p>
								<div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
									{[
										{
											key: "openai" as const,
											label: "OpenAI",
											placeholder: "sk-...",
										},
										{
											key: "anthropic" as const,
											label: "Anthropic",
											placeholder: "sk-ant-...",
										},
										{
											key: "gemini" as const,
											label: "Gemini",
											placeholder: "AI...",
										},
										{
											key: "grok" as const,
											label: "Grok",
											placeholder: "xai-...",
										},
										{
											key: "openrouter" as const,
											label: "OpenRouter",
											placeholder: "sk-or-...",
										},
									].map(({ key, label, placeholder }) => (
										<div key={key}>
											<label
												htmlFor={`cfg-${key}`}
												className="block text-[10px] font-medium text-gray-600 mb-0.5"
											>
												{label}
											</label>
											<input
												id={`cfg-${key}`}
												type="password"
												value={config.providerKeys[key]}
												onChange={(e) =>
													setProviderKey(key, e.target.value)
												}
												placeholder={placeholder}
												className="w-full px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
											/>
										</div>
									))}
								</div>
							</div>

							{/* Cloudflare Credentials */}
							<div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
								<p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
									{config.useBinding ? "AI Gateway" : "Cloudflare Credentials"}
								</p>
								<p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
									{config.useBinding
										? "Specify the gateway ID for env.AI.gateway(). Falls back to CLOUDFLARE_AI_GATEWAY_ID env var."
										: "Required for REST mode. Without these, the demo falls back to server-configured environment variables."}
								</p>
								<div className="grid gap-2.5">
									{!config.useBinding && (
										<div>
											<label
												htmlFor="cfg-account"
												className="block text-[10px] font-medium text-gray-600 mb-0.5"
											>
												Account ID
											</label>
											<input
												id="cfg-account"
												type="text"
												value={config.cloudflare.accountId}
												onChange={(e) =>
													setCloudflare({
														...config.cloudflare,
														accountId: e.target.value,
													})
												}
												placeholder="e.g. abc123def456..."
												className="w-full px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
											/>
										</div>
									)}
									<div>
										<label
											htmlFor="cfg-gateway"
											className="block text-[10px] font-medium text-gray-600 mb-0.5"
										>
											AI Gateway ID
										</label>
										<input
											id="cfg-gateway"
											type="text"
											value={config.cloudflare.gatewayId}
											onChange={(e) =>
												setCloudflare({
													...config.cloudflare,
													gatewayId: e.target.value,
												})
											}
											placeholder="default"
											className="w-full px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
										/>
									</div>
									{!config.useBinding && (
										<div>
											<label
												htmlFor="cfg-token"
												className="block text-[10px] font-medium text-gray-600 mb-0.5"
											>
												Cloudflare API Token
											</label>
											<input
												id="cfg-token"
												type="password"
												value={config.cloudflare.apiToken}
												onChange={(e) =>
													setCloudflare({
														...config.cloudflare,
														apiToken: e.target.value,
													})
												}
												placeholder="Your Cloudflare API token"
												className="w-full px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
											/>
										</div>
									)}
								</div>
							</div>
						</div>
					)}

					{/* Provider tabs */}
					<div className="flex overflow-x-auto -mb-px scrollbar-hide">
						{PROVIDERS.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => setActiveProviderId(p.id)}
								className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
									p.id === activeProviderId
										? "border-gray-900 text-gray-900"
										: "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
								}`}
							>
								<div
									className={`w-2 h-2 rounded-full bg-gradient-to-br ${p.color}`}
								/>
								{p.label}
							</button>
						))}
					</div>
				</header>

				{/* Provider content */}
				<div className="flex-1 flex flex-col overflow-hidden">
					<ProviderView key={activeProviderId} provider={activeProvider} />
				</div>
			</div>
		</div>
	);
}

function App() {
	return (
		<ConfigProvider>
			<AppContent />
		</ConfigProvider>
	);
}

export default App;
