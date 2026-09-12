import { useState } from "react";
import { useConfig } from "../config";
import type { ProviderDef } from "../providers";

const PLACEHOLDER_TEXT = `Cloudflare is a web infrastructure and security company that provides content delivery network (CDN) services, DDoS mitigation, Internet security, and distributed domain name server (DNS) services. Cloudflare's services sit between a website's visitor and the hosting provider, acting as a reverse proxy for websites. Its headquarters are in San Francisco, California, with additional offices in London, Singapore, Lisbon, and other cities around the world.

The company was founded in 2009 by Matthew Prince, Lee Holloway, and Michelle Zatlyn. It launched in September 2010 at TechCrunch Disrupt. The company has since grown to serve millions of websites and process a significant portion of internet traffic globally. In 2019, Cloudflare had its initial public offering (IPO) on the New York Stock Exchange.

Cloudflare Workers is a serverless application platform running on Cloudflare's global network in over 300 cities worldwide. Workers AI brings serverless GPU-powered machine learning directly to Cloudflare's network, allowing developers to run AI models with Workers AI bindings or the REST API. AI Gateway provides a unified control plane for managing and monitoring AI requests across multiple providers.`;

export function SummarizePanel({ provider }: { provider: ProviderDef }) {
	const [text, setText] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [summary, setSummary] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();

	const handleSummarize = async (e: React.FormEvent) => {
		e.preventDefault();
		const inputText = text.trim() || PLACEHOLDER_TEXT;
		if (isLoading) return;

		setIsLoading(true);
		setError(null);
		setSummary(null);

		try {
			const res = await fetch(`/ai/${provider.id}/summarize`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ text: inputText }),
			});

			const data = await res.json();

			if (!res.ok) {
				setError((data as { error?: string }).error || "Summarization failed");
				return;
			}

			const result = data as { summary?: string };
			if (result.summary) {
				setSummary(result.summary);
			} else {
				setError("No summary was returned");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex flex-col h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
			<div>
				<label
					htmlFor="summarize-input"
					className="block text-xs font-medium text-gray-700 mb-1.5"
				>
					Text to summarize
				</label>
				<textarea
					id="summarize-input"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={PLACEHOLDER_TEXT}
					rows={8}
					disabled={isLoading}
					className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-y"
				/>
				<div className="flex items-center justify-between mt-2">
					<p className="text-[10px] text-gray-400">
						{text.trim()
							? `${text.trim().length} characters`
							: "Leave empty to use the sample text above"}
					</p>
					<button
						type="button"
						onClick={handleSummarize}
						disabled={isLoading}
						className="px-5 py-2 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
								Summarizing...
							</div>
						) : (
							"Summarize"
						)}
					</button>
				</div>
			</div>

			{error && (
				<div className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			{summary && (
				<div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
					<p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
						Summary
					</p>
					<div className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
						{summary}
					</div>
				</div>
			)}

			{!summary && !isLoading && !error && (
				<div className="flex items-center justify-center py-12">
					<p className="text-xs text-gray-500">
						Paste text above or use the sample, then click Summarize.
					</p>
				</div>
			)}
		</div>
	);
}
