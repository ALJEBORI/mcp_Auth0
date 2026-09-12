import { useState } from "react";
import { ChatPanel } from "./panels/ChatPanel";
import { ImagePanel } from "./panels/ImagePanel";
import { SummarizePanel } from "./panels/SummarizePanel";
import { TranscriptionPanel } from "./panels/TranscriptionPanel";
import { TTSPanel } from "./panels/TTSPanel";
import { CAPABILITY_LABELS, type Capability, type ProviderDef } from "./providers";

export function ProviderView({ provider }: { provider: ProviderDef }) {
	const [activeCapability, setActiveCapability] = useState<Capability>(provider.capabilities[0]!);

	return (
		<div className="flex flex-col h-full">
			{/* Capability sub-tabs */}
			<div className="px-4 sm:px-6 pt-3 pb-0 bg-white border-b border-gray-200">
				<div className="flex gap-1 -mb-px">
					{provider.capabilities.map((cap) => {
						const def = CAPABILITY_LABELS[cap];
						return (
							<button
								key={cap}
								type="button"
								onClick={() => setActiveCapability(cap)}
								className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
									cap === activeCapability
										? "border-gray-900 text-gray-900"
										: "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
								}`}
							>
								<svg
									className="w-3.5 h-3.5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={2}
								>
									<title>{def.label}</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d={def.icon}
									/>
								</svg>
								{def.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Capability content */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{activeCapability === "chat" && <ChatPanel key={provider.id} provider={provider} />}
				{activeCapability === "image" && (
					<ImagePanel key={provider.id} provider={provider} />
				)}
				{activeCapability === "summarize" && (
					<SummarizePanel key={provider.id} provider={provider} />
				)}
				{activeCapability === "transcription" && (
					<TranscriptionPanel key={provider.id} provider={provider} />
				)}
				{activeCapability === "tts" && <TTSPanel key={provider.id} provider={provider} />}
			</div>
		</div>
	);
}
