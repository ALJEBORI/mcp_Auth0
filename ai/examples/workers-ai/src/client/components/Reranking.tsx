import { useState } from "react";
import { useConfig } from "../config";
import { rerankingModels } from "./models";

interface RankResult {
	index: number;
	score: number;
	document: string;
}

const DEFAULT_DOCS = [
	"Machine learning is a subset of artificial intelligence that focuses on learning from data.",
	"The weather forecast for tomorrow shows sunny skies with mild temperatures.",
	"Deep learning uses neural networks with many layers to model complex patterns.",
	"The recipe calls for two cups of flour, one egg, and a pinch of salt.",
	"Natural language processing enables computers to understand human language.",
];

export function Reranking() {
	const [model, setModel] = useState(rerankingModels[0].id);
	const [query, setQuery] = useState("");
	const [documents, setDocuments] = useState(DEFAULT_DOCS.join("\n"));
	const [results, setResults] = useState<RankResult[] | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();

	const handleRerank = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!query.trim() || !documents.trim() || isLoading) return;

		setIsLoading(true);
		setError(null);
		setResults(null);

		const docs = documents
			.split("\n")
			.map((d) => d.trim())
			.filter(Boolean);

		try {
			const res = await fetch("/api/rerank", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ query, documents: docs, model }),
			});

			if (!res.ok) {
				const errData = (await res.json()) as { error?: string };
				throw new Error(errData.error || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as { ranking: RankResult[] };
			setResults(data.ranking);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Reranking failed");
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
					{rerankingModels.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</div>

			<form className="space-y-3" onSubmit={handleRerank}>
				<div>
					<label className="block text-[10px] font-medium text-gray-600 mb-1">
						Query
					</label>
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="What are you searching for?"
						disabled={isLoading}
						className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50"
					/>
				</div>

				<div>
					<label className="block text-[10px] font-medium text-gray-600 mb-1">
						Documents (one per line)
					</label>
					<textarea
						value={documents}
						onChange={(e) => setDocuments(e.target.value)}
						rows={6}
						disabled={isLoading}
						className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 resize-y font-mono text-xs"
					/>
				</div>

				<div className="flex items-center justify-between">
					<p className="text-[10px] text-gray-400">
						{documents.split("\n").filter((d) => d.trim()).length} documents
					</p>
					<button
						type="submit"
						disabled={isLoading || !query.trim() || !documents.trim()}
						className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
					>
						{isLoading ? "Reranking..." : "Rerank"}
					</button>
				</div>
			</form>

			{!query && !results && !error && (
				<div className="flex flex-wrap gap-1.5">
					{[
						"What is machine learning?",
						"How to bake a cake",
						"What are neural networks?",
					].map((example) => (
						<button
							key={example}
							type="button"
							onClick={() => setQuery(example)}
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

			{results && (
				<div className="space-y-2">
					<p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
						Ranked Results
					</p>
					{results.map((r, i) => (
						<div
							key={`rank-${r.index}`}
							className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex items-start gap-3"
						>
							<div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center">
								{i + 1}
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-sm text-gray-900 leading-relaxed">
									{r.document}
								</p>
								<div className="mt-1 flex items-center gap-2">
									<div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden">
										<div
											className={`h-full rounded-full ${
												r.score > 0.8
													? "bg-emerald-500"
													: r.score > 0.5
														? "bg-amber-500"
														: "bg-gray-300"
											}`}
											style={{
												width: `${Math.min(100, Math.max(5, r.score * 100))}%`,
											}}
										/>
									</div>
									<span className="text-[10px] text-gray-500 font-mono w-12 text-right">
										{r.score.toFixed(3)}
									</span>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			{!results && !isLoading && !error && (
				<div className="text-center text-sm text-gray-400 py-4">
					Enter a query and documents, then click Rerank to see relevance scores.
				</div>
			)}
		</div>
	);
}
