import { useState } from "react";
import { useConfig } from "../config";
import type { ProviderDef } from "../providers";

interface GeneratedImage {
	id: string;
	prompt: string;
	url?: string;
	b64Json?: string;
	error?: string;
}

export function ImagePanel({ provider }: { provider: ProviderDef }) {
	const [prompt, setPrompt] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [images, setImages] = useState<GeneratedImage[]>([]);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();

	const handleGenerate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!prompt.trim() || isLoading) return;

		setIsLoading(true);
		setError(null);

		try {
			const res = await fetch(`/ai/${provider.id}/image`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ prompt }),
			});

			const data = await res.json();

			if (!res.ok) {
				setError((data as { error?: string }).error || "Image generation failed");
				return;
			}

			const result = data as { images?: Array<{ b64Json?: string; url?: string }> };
			const img = result.images?.[0];

			if (img) {
				setImages((prev) => [
					{ id: crypto.randomUUID(), prompt, url: img.url, b64Json: img.b64Json },
					...prev,
				]);
				setPrompt("");
			} else {
				setError("No image was returned");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex flex-col h-full">
			<div className="px-4 sm:px-6 pt-4 pb-4 border-b border-gray-100 bg-white">
				<form onSubmit={handleGenerate} className="flex gap-2">
					<input
						type="text"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Describe the image you want to generate..."
						disabled={isLoading}
						className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
					/>
					<button
						type="submit"
						disabled={isLoading || !prompt.trim()}
						className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
					>
						{isLoading ? (
							<div className="flex items-center gap-2">
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
							</div>
						) : (
							"Generate"
						)}
					</button>
				</form>
			</div>

			{error && (
				<div className="mx-4 sm:mx-6 mt-3 px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			<div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
				{images.length === 0 && !isLoading ? (
					<div className="h-full flex items-center justify-center">
						<div className="text-center max-w-sm">
							<p className="text-sm font-medium text-gray-900 mb-1">
								Generate images with {provider.label}
							</p>
							<p className="text-xs text-gray-500 leading-relaxed">
								Describe what you want to see.
							</p>
							<div className="mt-4 flex flex-wrap gap-1.5 justify-center">
								{[
									"A cat astronaut floating in space",
									"A cozy cabin in the snow",
									"Abstract neon cityscape",
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
						</div>
					</div>
				) : (
					<div className="grid grid-cols-1 gap-4">
						{isLoading && (
							<div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
								<div className="flex items-center gap-3">
									<svg
										className="animate-spin h-5 w-5 text-gray-400"
										viewBox="0 0 24 24"
									>
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
									<div>
										<p className="text-sm font-medium text-gray-900">
											Generating...
										</p>
										<p className="text-xs text-gray-500 mt-0.5">{prompt}</p>
									</div>
								</div>
							</div>
						)}
						{images.map((img) => (
							<div
								key={img.id}
								className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm"
							>
								{img.error ? (
									<div className="p-4 text-sm text-red-600">{img.error}</div>
								) : (
									<img
										src={
											img.b64Json
												? `data:image/png;base64,${img.b64Json}`
												: img.url
										}
										alt={img.prompt}
										className="w-full"
									/>
								)}
								<div className="px-4 py-3 border-t border-gray-100">
									<p className="text-xs text-gray-600">{img.prompt}</p>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
