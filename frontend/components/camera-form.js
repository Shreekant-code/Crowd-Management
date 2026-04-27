"use client";

import { useState } from "react";
import { PlusCircle } from "lucide-react";
import { changeCameraState, createCamera } from "@/lib/api";

const initialForm = {
  name: "",
  zoneName: "",
  location: "",
  streamUrl: "",
};

export function CameraForm({ onCameraCreated, onCameraChanged }) {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ loading: false, message: "", error: "" });

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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
        await onCameraChanged();
      }
      setForm(initialForm);
      setStatus({ loading: false, message: "Camera zone added and started successfully.", error: "" });
    } catch (error) {
      setStatus({ loading: false, message: "", error: error.message });
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Camera Name</span>
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slateblue"
          value={form.name}
          onChange={(event) => updateField("name", event.target.value)}
          placeholder="North Gate Cam"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Zone Name</span>
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slateblue"
          value={form.zoneName}
          onChange={(event) => updateField("zoneName", event.target.value)}
          placeholder="Zone A"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Location</span>
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slateblue"
          value={form.location}
          onChange={(event) => updateField("location", event.target.value)}
          placeholder="Stadium North Wing"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Stream URL</span>
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slateblue"
          value={form.streamUrl}
          onChange={(event) => updateField("streamUrl", event.target.value)}
          placeholder="http://phone-ip:8080/video or rtsp://camera/live"
        />
      </label>

      {status.message ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {status.message}
        </p>
      ) : null}
      {status.error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {status.error}
        </p>
      ) : null}

      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        disabled={status.loading}
        type="submit"
      >
        <PlusCircle className="h-4 w-4" />
        {status.loading ? "Saving..." : "Add Camera Zone"}
      </button>
    </form>
  );
}
