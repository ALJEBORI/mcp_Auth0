/**
 * Workers AI example app — interactive demo of all workers-ai-provider
 * capabilities. Each tab exercises a different AI SDK function against
 * Workers AI models. The worker backend is in src/server/index.ts.
 */
import { useState } from "react";
import { ConfigProvider, useConfig } from "./config";
import { Chat } from "./components/Chat";
import { Images } from "./components/Images";
import { Embeddings } from "./components/Embeddings";
import { Transcription } from "./components/Transcription";
import { TTS } from "./components/TTS";
import { Reranking } from "./components/Reranking";

const tabs = [
	{ id: "chat", label: "Chat" },
	{ id: "images", label: "Images" },
	{ id: "embeddings", label: "Embeddings" },
	{ id: "transcription", label: "Transcription" },
	{ id: "tts", label: "Speech" },
	{ id: "reranking", label: "Reranking" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
	return (
		<ConfigProvider>
			<AppContent />
		</ConfigProvider>
	);
}

function AppContent() {
	const [activeTab, setActiveTab] = useState<TabId>("chat");
	const [showSettings, setShowSettings] = useState(false);
	const { config, setConfig, isConfigured } = useConfig();

	return (
		<div className="size-full flex flex-col bg-gray-50">
			<div className="max-w-4xl w-full mx-auto flex flex-col flex-1 overflow-hidden">
				{/* Header */}
				<div className="bg-white border-b border-gray-200 px-4 sm:px-6 pt-4 pb-0">
					<div className="flex items-center justify-between mb-3">
						<div>
							<h1 className="text-lg font-semibold text-gray-900">Workers AI</h1>
							<p className="text-xs text-gray-500">
								AI SDK provider for Cloudflare Workers AI
							</p>
						</div>
						<button
							type="button"
							onClick={() => setShowSettings(!showSettings)}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
								isConfigured
									? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
									: "text-amber-700 bg-amber-50 hover:bg-amber-100"
							}`}
						>
							{isConfigured ? "Configured" : "Setup required"}
						</button>
					</div>

					{/* Settings Panel */}
					{showSettings && (
						<div className="mb-4 space-y-3">
							{/* Connection Mode */}
							<div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
								<div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
									Connection Mode
								</div>
								<div className="flex items-center gap-3">
									<button
										type="button"
										onClick={() => setConfig({ ...config, useBinding: true })}
										className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
											config.useBinding
												? "bg-gray-900 text-white"
												: "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
										}`}
									>
										Binding (env.AI)
									</button>
									<button
										type="button"
										onClick={() => setConfig({ ...config, useBinding: false })}
										className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
											!config.useBinding
												? "bg-gray-900 text-white"
												: "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
										}`}
									>
										REST API
									</button>
								</div>
								{config.useBinding && (
									<p className="text-[10px] text-gray-400 mt-2">
										Using env.AI binding. No credentials needed when running in
										a Worker.
									</p>
								)}
							</div>

							{/* REST Credentials */}
							{!config.useBinding && (
								<div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
									<div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
										Cloudflare Credentials
									</div>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
										<div>
											<label className="block text-[10px] font-medium text-gray-600 mb-1">
												Account ID
											</label>
											<input
												type="text"
												value={config.accountId}
												onChange={(e) =>
													setConfig({
														...config,
														accountId: e.target.value,
													})
												}
												placeholder="Your Cloudflare Account ID"
												className="w-full px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
											/>
										</div>
										<div>
											<label className="block text-[10px] font-medium text-gray-600 mb-1">
												API Token
											</label>
											<input
												type="password"
												value={config.apiKey}
												onChange={(e) =>
													setConfig({ ...config, apiKey: e.target.value })
												}
												placeholder="Workers AI API Token"
												className="w-full px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
											/>
										</div>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Tab Bar */}
					<nav className="flex -mb-px overflow-x-auto">
						{tabs.map((tab) => (
							<button
								type="button"
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
									activeTab === tab.id
										? "border-gray-900 text-gray-900"
										: "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
								}`}
							>
								{tab.label}
							</button>
						))}
					</nav>
				</div>

				{/* Content */}
				<div className="flex-1 flex flex-col overflow-hidden bg-white">
					{activeTab === "chat" && <Chat key="chat" />}
					{activeTab === "images" && <Images key="images" />}
					{activeTab === "embeddings" && <Embeddings key="embeddings" />}
					{activeTab === "transcription" && <Transcription key="transcription" />}
					{activeTab === "tts" && <TTS key="tts" />}
					{activeTab === "reranking" && <Reranking key="reranking" />}
				</div>
			</div>
		</div>
	);
}
