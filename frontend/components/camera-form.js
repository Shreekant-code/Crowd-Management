"use client";

import { useState } from "react";
import { PlusCircle, Radio, Sparkles } from "lucide-react";
import { changeCameraState, createCamera } from "@/lib/api";

const initialForm = {
  name: "",
  zoneName: "",
  location: "",
  streamUrl: "",
  sourceType: "http",
};

function isYouTubeSource(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.includes("youtube.com") || normalized.includes("youtu.be");
}

export function CameraForm({ onCameraCreated, onCameraChanged }) {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ loading: false, message: "", error: "" });

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateStreamUrl(value) {
    setForm((current) => {
      const nextForm = { ...current, streamUrl: value };
      if (isYouTubeSource(value)) {
        nextForm.sourceType = "public";
      }
      return nextForm;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ loading: true, message: "", error: "" });

    try {
      const data = await createCamera(form);
      let latestCamera = data?.camera || null;
      if (data?.camera?.id) {
        const started = await changeCameraState(data.camera.id, "start");
        latestCamera = started?.camera || latestCamera;
      }
      if (latestCamera && onCameraCreated) {
        onCameraCreated(latestCamera);
      }
      if (onCameraChanged) {
        await onCameraChanged(latestCamera);
      }
      setForm(initialForm);
      setStatus({ loading: false, message: "Camera zone added and started successfully.", error: "" });
    } catch (error) {
      setStatus({ loading: false, message: "", error: error.message });
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block space-y-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Camera Name</span>
        <input
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-500"
          value={form.name}
          onChange={(event) => updateField("name", event.target.value)}
          placeholder="e.g. North Gate Cam 01"
          required
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Zone Name</span>
        <input
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-500"
          value={form.zoneName}
          onChange={(event) => updateField("zoneName", event.target.value)}
          placeholder="e.g. Zone A: North Gate Plaza"
          required
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Location</span>
        <input
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-500"
          value={form.location}
          onChange={(event) => updateField("location", event.target.value)}
          placeholder="e.g. Stadium North Wing"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Source Type</span>
        <select
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-white outline-none transition focus:border-teal-500"
          value={form.sourceType}
          onChange={(event) => updateField("sourceType", event.target.value)}
        >
          <option value="http">HTTP Live Stream / MJPEG</option>
          <option value="rtsp">RTSP Surveillance Camera</option>
          <option value="webcam">Integrated Webcam</option>
          <option value="public">YouTube / Public Media URL</option>
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Stream URL</span>
        <input
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-500"
          value={form.streamUrl}
          onChange={(event) => updateStreamUrl(event.target.value)}
          placeholder={
            form.sourceType === "rtsp"
              ? "rtsp://192.168.1.100:554/live"
              : form.sourceType === "webcam"
                ? "webcam://0"
                : form.sourceType === "public"
                  ? "https://www.youtube.com/embed/VIDEO_ID"
                  : "http://192.168.1.50:8080/video"
          }
          required
        />
        <p className="text-[11px] text-slate-400">
          DirectML GStreamer hardware ingestion pipeline automatically ingests and decimates to 2 FPS in GPU memory.
        </p>
      </label>

      {status.message && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
          {status.message}
        </p>
      )}

      {status.error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs font-semibold text-red-300">
          {status.error}
        </p>
      )}

      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white font-extrabold px-5 py-3 text-xs shadow-lg shadow-teal-500/30 transition hover:scale-[1.01] active:scale-95 disabled:opacity-60 cursor-pointer"
        disabled={status.loading}
        type="submit"
      >
        <PlusCircle className="h-4 w-4" />
        {status.loading ? "Provisioning DirectML Pipeline..." : "Register & Start Zone"}
      </button>
    </form>
  );
}
