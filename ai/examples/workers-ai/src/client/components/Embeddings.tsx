import { useState } from "react";
import { useConfig } from "../config";
import { embeddingModels } from "./models";

interface EmbedResult {
	embeddings: Array<{ dimensions: number; preview: number[] }>;
	similarities: number[][];
}

export function Embeddings() {
	const [model, setModel] = useState(embeddingModels[0].id);
	const [text1, setText1] = useState("The weather is beautiful today");
	const [text2, setText2] = useState("It's a gorgeous sunny afternoon");
	const [result, setResult] = useState<EmbedResult | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();

	const handleCompare = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!text1.trim() || !text2.trim() || isLoading) return;

		setIsLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/embed", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ texts: [text1, text2], model }),
			});

			if (!res.ok) {
				const body = (await res.json()) as { error?: string };
				throw new Error(body.error || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as EmbedResult;
			setResult(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to embed");
		} finally {
			setIsLoading(false);
		}
	};

	const similarity = result?.similarities?.[0]?.[1];

	return (
		<div className="flex flex-col h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
			<div className="flex items-center gap-2">
				<label className="text-[10px] font-medium text-gray-600">Model</label>
				<select
					value={model}
					onChange={(e) => setModel(e.target.value)}
					className="text-xs text-gray-600 bg-white border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-900"
				>
					{embeddingModels.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</div>

			<form className="space-y-3" onSubmit={handleCompare}>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label className="block text-[10px] font-medium text-gray-600 mb-1">
							Text 1
						</label>
						<textarea
							value={text1}
							onChange={(e) => setText1(e.target.value)}
							placeholder="First text..."
							rows={3}
							disabled={isLoading}
							className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 resize-y"
						/>
					</div>
					<div>
						<label className="block text-[10px] font-medium text-gray-600 mb-1">
							Text 2
						</label>
						<textarea
							value={text2}
							onChange={(e) => setText2(e.target.value)}
							placeholder="Second text..."
							rows={3}
							disabled={isLoading}
							className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 resize-y"
						/>
					</div>
				</div>
				<button
					type="submit"
					disabled={isLoading || !text1.trim() || !text2.trim()}
					className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					{isLoading ? "Computing..." : "Compare"}
				</button>
			</form>

			{error && (
				<div className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			{result && similarity != null && (
				<div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-4">
					<div>
						<div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
							Cosine Similarity
						</div>
						<div className="text-2xl font-semibold text-gray-900">
							{similarity.toFixed(4)}
						</div>
						<div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
							<div
								className={`h-full rounded-full transition-all ${
									similarity > 0.8
										? "bg-emerald-500"
										: similarity > 0.5
											? "bg-amber-500"
											: "bg-red-400"
								}`}
								style={{ width: `${Math.max(0, similarity) * 100}%` }}
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{result.embeddings.map((emb, i) => (
							<div key={`embed-${i}`} className="p-3 bg-gray-50 rounded-lg">
								<div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">
									Text {i + 1} ({emb.dimensions} dimensions)
								</div>
								<code className="text-[10px] text-gray-600 break-all">
									[{emb.preview.map((v) => v.toFixed(4)).join(", ")}, ...]
								</code>
							</div>
						))}
					</div>
				</div>
			)}

			{!result && !isLoading && !error && (
				<div className="text-center text-sm text-gray-400 py-8">
					Enter two texts and click Compare to see how semantically similar they are.
				</div>
			)}
		</div>
	);
}
