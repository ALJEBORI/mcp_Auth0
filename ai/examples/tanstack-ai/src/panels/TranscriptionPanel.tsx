import { useCallback, useRef, useState } from "react";
import { useConfig } from "../config";
import type { ProviderDef } from "../providers";

export function TranscriptionPanel({ provider }: { provider: ProviderDef }) {
	const [isLoading, setIsLoading] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [transcription, setTranscription] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { headers } = useConfig();
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const sendAudio = useCallback(
		async (audioBlob: Blob) => {
			setIsLoading(true);
			setError(null);
			setTranscription(null);

			try {
				const buffer = await audioBlob.arrayBuffer();
				const bytes = new Uint8Array(buffer);
				let binary = "";
				for (let i = 0; i < bytes.length; i++) {
					binary += String.fromCharCode(bytes[i]!);
				}
				const base64 = btoa(binary);

				const res = await fetch(`/ai/${provider.id}/transcription`, {
					method: "POST",
					headers: { "Content-Type": "application/json", ...headers },
					body: JSON.stringify({ audio: base64 }),
				});

				const data = await res.json();

				if (!res.ok) {
					setError((data as { error?: string }).error || "Transcription failed");
					return;
				}

				const result = data as { text?: string };
				if (result.text) {
					setTranscription(result.text);
				} else {
					setError("No transcription was returned");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setIsLoading(false);
			}
		},
		[provider.id, headers],
	);

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mediaRecorder = new MediaRecorder(stream);
			mediaRecorderRef.current = mediaRecorder;
			chunksRef.current = [];

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};

			mediaRecorder.onstop = () => {
				const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
				stream.getTracks().forEach((t) => t.stop());
				sendAudio(audioBlob);
			};

			mediaRecorder.start();
			setIsRecording(true);
		} catch {
			setError("Microphone access denied");
		}
	}, [sendAudio]);

	const stopRecording = useCallback(() => {
		mediaRecorderRef.current?.stop();
		setIsRecording(false);
	}, []);

	const handleFileUpload = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) sendAudio(file);
		},
		[sendAudio],
	);

	return (
		<div className="flex flex-col h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
			<div className="flex flex-col items-center gap-4 py-8">
				{/* Record button */}
				<button
					type="button"
					onClick={isRecording ? stopRecording : startRecording}
					disabled={isLoading}
					className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
						isRecording
							? "bg-red-500 hover:bg-red-600 animate-pulse"
							: "bg-gray-900 hover:bg-gray-800"
					} text-white disabled:opacity-40 disabled:cursor-not-allowed`}
				>
					<svg
						className="w-8 h-8"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<title>{isRecording ? "Stop Recording" : "Start Recording"}</title>
						{isRecording ? (
							<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
						) : (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
							/>
						)}
					</svg>
				</button>

				<p className="text-xs text-gray-500">
					{isRecording
						? "Recording... click to stop"
						: isLoading
							? "Transcribing..."
							: "Click to record or upload a file"}
				</p>

				{/* File upload */}
				<div>
					<input
						ref={fileInputRef}
						type="file"
						accept="audio/*"
						onChange={handleFileUpload}
						className="hidden"
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={isLoading || isRecording}
						className="px-4 py-2 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						Upload audio file
					</button>
				</div>
			</div>

			{isLoading && (
				<div className="flex items-center justify-center gap-2 py-4">
					<svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24">
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
					<span className="text-sm text-gray-500">Transcribing audio...</span>
				</div>
			)}

			{error && (
				<div className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
					{error}
				</div>
			)}

			{transcription && (
				<div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
					<p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
						Transcription
					</p>
					<div className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
						{transcription}
					</div>
				</div>
			)}
		</div>
	);
}
