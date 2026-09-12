import { useState, useRef } from "react";
import { useConfig } from "../config";
import { transcriptionModels } from "./models";

export function Transcription() {
	const [model, setModel] = useState(transcriptionModels[0].id);
	const [text, setText] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);

	const transcribeAudio = async (audioBase64: string) => {
		setIsLoading(true);
		setError(null);
		setText(null);

		try {
			const res = await fetch("/api/transcribe", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ audio: audioBase64, model }),
			});

			if (!res.ok) {
				const errData = (await res.json()) as { error?: string };
				throw new Error(errData.error || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as { text: string };
			setText(data.text);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Transcription failed");
		} finally {
			setIsLoading(false);
		}
	};

	const startRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mediaRecorder = new MediaRecorder(stream);
			mediaRecorderRef.current = mediaRecorder;
			chunksRef.current = [];

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};

			mediaRecorder.onstop = async () => {
				stream.getTracks().forEach((t) => t.stop());
				const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
				const reader = new FileReader();
				reader.onloadend = () => {
					const base64 = (reader.result as string).split(",")[1];
					transcribeAudio(base64);
				};
				reader.readAsDataURL(blob);
			};

			mediaRecorder.start();
			setIsRecording(true);
			// oxlint-disable-next-line no-unused-vars
		} catch (_err) {
			setError("Microphone access denied");
		}
	};

	const stopRecording = () => {
		mediaRecorderRef.current?.stop();
		setIsRecording(false);
	};

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onloadend = () => {
			const base64 = (reader.result as string).split(",")[1];
			transcribeAudio(base64);
		};
		reader.readAsDataURL(file);
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
					{transcriptionModels.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
			</div>

			<div className="flex flex-col sm:flex-row gap-3">
				<button
					type="button"
					onClick={isRecording ? stopRecording : startRecording}
					disabled={isLoading}
					className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 ${
						isRecording
							? "bg-red-500 hover:bg-red-600 text-white"
							: "bg-gray-900 hover:bg-gray-800 text-white"
					}`}
				>
					{isRecording ? (
						<span className="flex items-center gap-2">
							<span className="w-2 h-2 rounded-full bg-white animate-pulse" />
							Stop Recording
						</span>
					) : (
						"Record Audio"
					)}
				</button>

				<label className="px-5 py-2.5 rounded-xl text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors text-center">
					Upload File
					<input
						type="file"
						accept="audio/*"
						onChange={handleFileUpload}
						className="hidden"
						disabled={isLoading}
					/>
				</label>
			</div>

			{isLoading && (
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
					Transcribing...
				</div>
			)}

			{error && (
				<div className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			{text != null && (
				<div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
					<p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
						Transcription
					</p>
					<p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
						{text || "(empty — no speech detected)"}
					</p>
				</div>
			)}

			{text == null && !isLoading && !error && (
				<div className="text-center text-sm text-gray-400 py-8">
					Record audio or upload a file to transcribe speech to text.
				</div>
			)}
		</div>
	);
}
