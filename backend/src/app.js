import express from "express";
import cors from "cors";
import cameraRoutes from "./routes/cameraRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import { receiveUploadResult } from "./controllers/aiCallbackController.js";
import { frontendUrl } from "./config/env.js";
import { requireAiCallbackAuth } from "./middleware/requireAiCallbackAuth.js";
import { requirePlatformAuth } from "./middleware/requirePlatformAuth.js";

const app = express();

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/internal/ai/upload-result", requireAiCallbackAuth, receiveUploadResult);

app.use("/api/cameras", requirePlatformAuth, cameraRoutes);
app.use("/api/dashboard", requirePlatformAuth, dashboardRoutes);
app.use("/api/stream", requirePlatformAuth, streamRoutes);
app.use("/api/uploads", requirePlatformAuth, uploadRoutes);

app.use((error, _req, res, _next) => {
  res.status(400).json({
    message: error.message || "Unexpected server error",
  });
});

export default app;
