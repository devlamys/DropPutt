import { Mic, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_SECONDS = 60;
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

/** "Hold to record" voice route. Calls onChange(Blob | null). */
export default function VoiceRecorder({ value, onChange, disabled }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef(null);
  const holding = useRef(false);
  const timer = useRef(null);
  const url = useRef(null);
  const supported = typeof window !== "undefined" && pickMimeType() !== null && navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => {
    clearInterval(timer.current);
    if (url.current) URL.revokeObjectURL(url.current);
    recorder.current?.stream?.getTracks().forEach((t) => t.stop());
  }, []);

  if (value && !url.current) url.current = URL.createObjectURL(value);
  if (!value && url.current) {
    URL.revokeObjectURL(url.current);
    url.current = null;
  }

  async function start(event) {
    event.preventDefault();
    if (disabled || recording) return;
    holding.current = true;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Released while the permission prompt was open: do not record.
      if (!holding.current) {
        stream.getTracks().forEach((t) => t.stop());
        setError("Press and hold the button while you speak.");
        return;
      }
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
        if (blob.size < 1500) {
          setError("Too short — hold the button and speak your directions.");
          return;
        }
        onChange(blob);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      const began = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
    } catch {
      holding.current = false;
      setError("Microphone permission is needed to record directions.");
    }
  }

  function stop() {
    holding.current = false;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  if (!supported) {
    return <p className="text-sm text-slate-500">Voice recording is not supported in this browser. Type a landmark instead.</p>;
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-2 rounded-2xl bg-blue-50 p-3">
          <audio controls src={url.current} className="h-10 min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700"
          >
            <RotateCcw className="h-4 w-4" /> Redo
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={() => recording && stop()}
          onPointerCancel={stop}
          onContextMenu={(e) => e.preventDefault()}
          className={`flex w-full touch-none select-none items-center justify-center gap-3 rounded-2xl py-5 text-lg font-bold text-white shadow transition disabled:opacity-60 ${
            recording ? "scale-[1.02] bg-red-600" : "bg-blue-600 active:scale-95"
          }`}
        >
          {recording ? <Square className="h-6 w-6 animate-pulse" /> : <Mic className="h-6 w-6" />}
          {recording ? `Recording… ${seconds}s — release to stop` : "🎤 Hold to Record Voice Route"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
