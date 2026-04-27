"use client";

import { useState } from "react";
import { Film, Loader2 } from "lucide-react";
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
      <label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
        <Film className="mx-auto h-6 w-6 text-slate-500" />
        <p className="mt-3 text-sm font-medium text-slate-700">Upload incident video</p>
        <p className="mt-1 text-xs text-slate-500">Supported: MP4, MOV, MKV, WEBM</p>
        <input
          accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
          className="mt-4 block w-full text-sm text-slate-500"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
          type="file"
        />
      </label>

      {state.error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{state.error}</p>
      ) : null}

      {state.result ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{state.result.file.originalName}</p>
              <p className="text-xs text-slate-500">
                Processed at {new Date(state.result.analysis.processedAt).toLocaleString()}
              </p>
            </div>
            <span className={`${riskClass(state.result.analysis.risk)} rounded-full`}>
              {state.result.analysis.risk}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Detected Crowd</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{state.result.analysis.count}</p>
            </div>
            <div className="rounded-2xl bg-white p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Processed File</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{state.result.file.storedName}</p>
            </div>
          </div>
        </div>
      ) : null}

      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-[#e45743] disabled:opacity-60"
        disabled={!file || state.loading}
        type="submit"
      >
        {state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
        {state.loading ? "Processing..." : "Process Video"}
      </button>
    </form>
  );
}

