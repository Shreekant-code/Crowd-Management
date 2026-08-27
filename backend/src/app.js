import express from "express";
import cors from "cors";
import cameraRoutes from "./routes/cameraRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import globalRoutes from "./routes/globalRoutes.js";
import streamRoutes from "./routes/streamRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import evacuationRoutes from "./routes/evacuationRoutes.js";
import { receiveUploadResult, receiveTelemetryBatch } from "./controllers/aiCallbackController.js";
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
app.use(express.json({ limit: "20mb" }));
app.use((req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      console.error("api_request_failed", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      });
    }
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/internal/ai/upload-result", requireAiCallbackAuth, receiveUploadResult);
app.post("/internal/telemetry/batch", receiveTelemetryBatch);
app.post("/api/internal/telemetry/batch", receiveTelemetryBatch);

app.use("/api/cameras", requirePlatformAuth, cameraRoutes);
app.use("/api/dashboard", requirePlatformAuth, dashboardRoutes);
app.use("/api/global", requirePlatformAuth, globalRoutes);
app.use("/api/stream", requirePlatformAuth, streamRoutes);
app.use("/api/uploads", requirePlatformAuth, uploadRoutes);
app.use("/api/evacuation", requirePlatformAuth, evacuationRoutes);

app.use((error, req, res, _next) => {
  const statusCode = error.statusCode || error.status || 500;
  console.error("api_unhandled_error", {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    error,
  });
  res.status(statusCode).json({
    message: statusCode >= 500 ? "Unexpected server error" : error.message || "Request failed",
  });
});

export default app;
