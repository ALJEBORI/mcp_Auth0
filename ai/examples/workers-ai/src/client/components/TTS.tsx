import { useRef, useState } from "react";
import { useConfig } from "../config";
import { ttsModels } from "./models";

export function TTS() {
	const [model, setModel] = useState(ttsModels[0].id);
	const [text, setText] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();
	const audioRef = useRef<HTMLAudioElement>(null);

	const handleGenerate = async () => {
		if (!text.trim() || isLoading) return;

		setIsLoading(true);
		setError(null);
		setAudioUrl(null);

		try {
			const res = await fetch("/api/speech", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ text, model }),
			});

			if (!res.ok) {
				const errData = (await res.json()) as { error?: string };
				throw new Error(errData.error || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as { audio: string; contentType: string };
			const mime = data.contentType || "audio/mp3";
			setAudioUrl(`data:${mime};base64,${data.audio}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Speech generation failed");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex flex-col h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
			<div className="flex items-center gap-2">
				<label className="text-[10px] font-medium text-gray-600">Model</label>
				<select
					value={model}
					onChange={(e) => setModel(e.target.value)}
					className="text-xs text-gray-600 bg-white border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-900"
				>
					{ttsModels.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</div>

			<div>
				<label className="block text-[10px] font-medium text-gray-600 mb-1">
					Text to speak
				</label>
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="Enter text to convert to speech..."
					rows={4}
					disabled={isLoading}
					className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 resize-y"
				/>
				<div className="flex items-center justify-between mt-2">
					<p className="text-[10px] text-gray-400">
						{text.trim() ? `${text.trim().length} characters` : ""}
					</p>
					<button
						type="button"
						onClick={handleGenerate}
						disabled={isLoading || !text.trim()}
						className="px-5 py-2 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
					>
						{isLoading ? (
							<span className="flex items-center gap-2">
								<svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
									<title>Loading</title>
									<circle
										className="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										strokeWidth="4"
										fill="none"
									/>
									<path
										className="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									/>
								</svg>
								Generating...
							</span>
						) : (
							"Generate Speech"
						)}
					</button>
				</div>
			</div>

			{!audioUrl && !isLoading && !error && (
				<div className="flex flex-wrap gap-1.5">
					{[
						"Hello! Welcome to Cloudflare Workers AI.",
						"The quick brown fox jumps over the lazy dog.",
						"Artificial intelligence is transforming how we build software.",
					].map((example) => (
						<button
							key={example}
							type="button"
							onClick={() => setText(example)}
							className="px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors"
						>
							{example.slice(0, 40)}...
						</button>
					))}
				</div>
			)}

			{error && (
				<div className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			{audioUrl && (
				<div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
					<p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
						Generated Audio
					</p>
					<audio ref={audioRef} controls src={audioUrl} className="w-full">
						<track kind="captions" />
					</audio>
				</div>
			)}
		</div>
	);
}
