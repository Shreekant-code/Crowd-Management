"use client";

import { useState } from "react";
import { CheckCircle2, Cpu, Film, Loader2, Sparkles, UploadCloud } from "lucide-react";
import { uploadVideo } from "@/lib/api";
import { riskClass } from "@/lib/risk";

export function UploadPanel() {
  const [file, setFile] = useState(null);
  const [state, setState] = useState({
    loading: false,
    error: "",
    result: null,
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append("video", file);

    setState({ loading: true, error: "", result: null });

    try {
      const result = await uploadVideo(formData);
      setState({ loading: false, error: "", result });
      setFile(null);
      event.target.reset();
    } catch (error) {
      setState({ loading: false, error: error.message, result: null });
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-800 bg-slate-950/60 p-8 text-center transition hover:border-teal-500/50 hover:bg-teal-500/5">
        <UploadCloud className="mx-auto h-10 w-10 text-teal-400/80" />
        <p className="mt-3 text-sm font-bold text-white">
          {file ? file.name : "Select or Drop Surveillance Footage"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Supported Formats: MP4, MOV, MKV, WEBM (DirectML Batch Processing)
        </p>
        <input
          accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
          className="hidden"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
          type="file"
        />
      </label>

      {file && (
        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-300">
          <span>Selected File: <strong className="text-white">{file.name}</strong> ({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="text-xs font-bold text-red-400 hover:text-red-300"
          >
            Remove
          </button>
        </div>
      )}

      {state.error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
          {state.error}
        </p>
      )}

      {state.result && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-teal-400" />
                <p className="text-sm font-bold text-white">{state.result.file?.originalName || "Uploaded Media"}</p>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Processed via DirectML AI at {new Date(state.result.analysis?.processedAt || Date.now()).toLocaleTimeString()}
              </p>
            </div>
            <span className={riskClass(state.result.analysis?.risk || "Low")}>
              {state.result.analysis?.risk || "Low"}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Heads Counted</span>
              <p className="mt-1 text-2xl font-bold text-white">{state.result.analysis?.count ?? 0}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Risk Assessment</span>
              <p className="mt-1 text-xl font-bold text-teal-400">{state.result.analysis?.risk ?? "Low"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stored Target</span>
              <p className="mt-1 text-xs font-bold text-slate-300 truncate">{state.result.file?.storedName || "archived.mp4"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Acceleration</span>
              <p className="mt-1 text-xs font-bold text-cyan-400">AMD DirectML FP16</p>
            </div>
          </div>
        </div>
      )}

      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white font-extrabold px-5 py-3 text-xs shadow-lg shadow-teal-500/25 transition hover:scale-[1.01] active:scale-95 disabled:opacity-50 cursor-pointer"
        disabled={!file || state.loading}
        type="submit"
      >
        {state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
        {state.loading ? "Processing Footage with DirectML Engine..." : "Analyze Footage Offline"}
      </button>
    </form>
  );
}
