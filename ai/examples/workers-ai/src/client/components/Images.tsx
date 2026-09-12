import { useState } from "react";
import { useConfig } from "../config";
import { imageModels } from "./models";

export function Images() {
	const [model, setModel] = useState(imageModels[0].id);
	const [prompt, setPrompt] = useState("");
	const [image, setImage] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();

	const handleGenerate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!prompt.trim() || isLoading) return;

		setIsLoading(true);
		setError(null);
		setImage(null);

		try {
			const res = await fetch("/api/image", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ prompt, model }),
			});

			if (!res.ok) {
				const body = (await res.json()) as { error?: string };
				throw new Error(body.error || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as { image: string };
			setImage(data.image);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to generate image");
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
					{imageModels.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</div>

			<form className="flex gap-2" onSubmit={handleGenerate}>
				<input
					type="text"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder="Describe the image you want to generate..."
					disabled={isLoading}
					className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50"
				/>
				<button
					type="submit"
					disabled={isLoading || !prompt.trim()}
					className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
				>
					{isLoading ? "Generating..." : "Generate"}
				</button>
			</form>

			{!image && !isLoading && !error && (
				<div className="flex flex-wrap gap-1.5">
					{[
						"A cat astronaut floating in space",
						"A watercolor painting of a mountain landscape",
						"A minimalist logo design of a coffee cup",
					].map((example) => (
						<button
							key={example}
							type="button"
							onClick={() => setPrompt(example)}
							className="px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors"
						>
							{example}
						</button>
					))}
				</div>
			)}

			{error && (
				<div className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			{isLoading && (
				<div className="flex items-center justify-center py-12">
					<div className="flex items-center gap-2 text-sm text-gray-400">
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
						Generating image...
					</div>
				</div>
			)}

			{image && (
				<div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
					<img src={image} alt={prompt} className="w-full rounded-lg" />
				</div>
			)}

			{!image && !isLoading && !error && (
				<div className="text-center text-sm text-gray-400 py-8">
					Enter a prompt and click Generate to create an image.
				</div>
			)}
		</div>
	);
}
