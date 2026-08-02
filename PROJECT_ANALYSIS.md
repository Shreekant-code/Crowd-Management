# Project Analysis

## 1. Current Architecture

This repository is a monorepo with three major runtime surfaces:

- `frontend/` is a Next.js App Router application that renders the operator dashboard, auth pages, live camera cards, alerts, and upload UI.
- `backend/` is an Express API and Socket.IO server that owns camera registration, dashboard aggregation, stream proxying, upload orchestration, and user-scoped realtime events.
- `python-service/` is a FastAPI-based AI service that performs frame ingestion, YOLO detection, tracking, density estimation, temporal prediction, and live stream processing.

The platform uses local JSON files in `data/` and `backend/data/` for persistence. The current design is intentionally lightweight and file-backed rather than database-backed.

There are two Python entrypoints:

- `python-service/main.py` is the primary AI runtime for file jobs and live stream processing.
- `python-service/advanced_models/app.py` is a separate advanced live stream service that focuses on live camera proxying and per-session crowd analytics.

The current pipeline is:

`Video Source -> YOLO Person Detection -> Tracking -> CSRNet Density Estimation -> ConvLSTM Prediction -> Alert Engine -> Dashboard`

That pipeline is already present and should be preserved.

## 2. Folder Structure

### Root

- `README.md` contains the high-level product and run instructions.
- `package.json` defines workspace scripts for frontend and backend.
- `data/` holds shared local data files.
- `backend/` contains Express API code.
- `frontend/` contains the Next.js UI and frontend API routes.
- `python-service/` contains the AI service and model artifacts.
- `node_modules/` is installed dependencies.
- `yolov8n.pt` is a model artifact at the repository root.

### Backend

- `backend/src/app.js` wires Express middleware and routes.
- `backend/src/server.js` starts HTTP and Socket.IO, registers sockets, and handles shutdown.
- `backend/src/controllers/` contains request handlers for cameras, streams, uploads, dashboard, and AI callbacks.
- `backend/src/routes/` contains REST route definitions.
- `backend/src/services/` contains socket broadcasting, camera worker management, AI request state, and Python service HTTP integration.
- `backend/src/data/` contains JSON persistence helpers and repositories.
- `backend/src/utils/` contains ffmpeg helpers, file cleanup, and compatibility prediction wrappers.
- `backend/src/middleware/` contains auth and upload middleware.
- `backend/src/config/env.js` centralizes backend environment variables.

### Frontend

- `frontend/app/` contains pages and route handlers.
- `frontend/components/` contains dashboard widgets, feeds, forms, alerts, and providers.
- `frontend/lib/` contains client API helpers, server API helpers, auth, sockets, and risk utilities.
- `frontend/middleware.js` handles app-level request filtering.
- `frontend/tailwind.config.js`, `frontend/postcss.config.js`, and `frontend/next.config.js` configure the UI build.

### Python Service

- `python-service/main.py` is the main FastAPI AI service.
- `python-service/advanced_models/` contains the advanced live runtime and model artifacts.
- `python-service/utils/` contains frame capture, analytics, config, schemas, callbacks, and runtime orchestration.
- `python-service/detector.py` contains YOLO inference.
- `python-service/tracker.py` contains tracking logic.
- `python-service/requirements.txt` defines Python dependencies.

## 3. Existing Pipeline

### File Upload Pipeline

1. The frontend upload panel posts a video file to the frontend API.
2. Next.js forwards the upload to the backend upload route.
3. The backend normalizes the file with ffmpeg.
4. The backend calls the Python AI service via `mockPredict()` compatibility code.
5. The Python service processes frames, generates metrics, and optionally returns the result immediately or through callback state.
6. The backend stores the result and the frontend dashboard refreshes it.

### Live Camera Pipeline

1. The frontend registers a camera with a stream URL.
2. The backend stores the camera in JSON persistence.
3. When the camera starts, the backend worker manager polls the Python AI service.
4. The Python AI service reads the stream, detects people, tracks them, builds analytics, and returns live metrics.
5. The backend updates camera metrics, emits Socket.IO events, and adds alerts when needed.
6. The frontend receives socket updates and also polls live stats as a fallback.

### Advanced Python Live Pipeline

1. `python-service/advanced_models/app.py` creates a live session per camera.
2. `CrowdRuntime` processes each frame.
3. YOLO and tracker outputs are combined with CSRNet and ConvLSTM when enabled.
4. The service returns annotated frames and a rich metric payload for the dashboard.

## 4. Backend Flow

### Startup

- `backend/src/server.js` creates the HTTP server.
- Socket.IO is attached to the same server.
- `cameraRepository.resetRunningStatuses()` forces stored cameras back to `stopped` on restart.
- Socket authentication uses a signed token.

### Request Flow

- `backend/src/app.js` mounts platform auth, camera routes, dashboard routes, stream routes, and upload routes.
- `requirePlatformAuth` protects user-scoped endpoints.
- `requireAiCallbackAuth` protects callback ingestion.

### Camera Flow

- `backend/src/controllers/cameraController.js` creates, starts, stops, deletes, and previews cameras.
- `cameraRepository` persists camera objects.
- `cameraWorkerManager` updates live metrics and emits dashboard/camera events.

### Stream Flow

- `backend/src/controllers/streamController.js` proxies live video or fetches live stats from the Python service.
- If the Python live proxy is enabled, the backend forwards the stream to `python-service/advanced_models/app.py`.
- If live proxy fails, it falls back to ffmpeg-based preview streaming.

### Alert Flow

- `cameraWorkerManager` builds alerts from prediction results.
- `alertRepository` persists alerts in JSON.
- `socketHub` broadcasts `alert:new`.

## 5. Frontend Flow

### Entry Pages

- `frontend/app/page.js` is the marketing landing page.
- `frontend/app/login/page.js` and `frontend/app/signup/page.js` handle auth entry.
- `frontend/app/dashboard/page.js` loads dashboard data from the backend and renders `DashboardShell`.

### Dashboard

- `frontend/components/dashboard-shell.js` is the main operator workspace.
- It connects the Socket.IO client.
- It loads summary data and updates the dashboard on camera and alert events.
- It renders summary cards, camera registration, camera grid, upload panel, alerts, and risk watch widgets.

### Camera Cards

- `frontend/components/camera-grid.js` renders each camera card.
- `frontend/components/camera-feed.js` renders the live feed and overlays detections and heatmaps in the browser.
- `frontend/components/camera-form.js` creates new cameras.

### Alerts and Summary

- `frontend/components/summary-cards.js` renders top-level counts.
- `frontend/components/alerts-panel.js` renders the rolling alert feed.

## 6. Python AI Flow

### Main AI Service

- `python-service/main.py` handles file jobs and live stream processing.
- `StreamProcessor` reads frames from `LatestFrameCapture`.
- `CrowdRuntime` runs the full AI pipeline.
- The output is returned through `/streams/start`, `/streams/{camera_id}/latest`, and `/jobs/{job_id}`.

### Crowd Runtime

- `python-service/utils/crowd_runtime.py` is the core orchestrator.
- It owns the detector, tracker, CSRNet estimator, and ConvLSTM predictor.
- It smooths counts, estimates density, generates heatmaps, and summarizes prediction.
- It chooses between YOLO and CSRNet using crowd thresholds and current mode.

### Models

- `python-service/detector.py` runs YOLO person detection.
- `python-service/tracker.py` keeps track IDs stable.
- `python-service/advanced_models/csrnet.py` loads and runs CSRNet density estimation.
- `python-service/advanced_models/convlstm.py` loads and runs temporal count prediction.
- `python-service/advanced_models/model_loader.py` handles Torch artifact loading and pickle loading.

### Advanced Live Service

- `python-service/advanced_models/app.py` provides live streaming endpoints for the advanced runtime.
- It owns per-camera live sessions, frame decoding, runtime processing, and MJPEG output.

## 7. REST APIs

### Current Backend APIs

- `GET /api/health`
- `POST /internal/ai/upload-result`
- `GET /api/cameras`
- `POST /api/cameras`
- `POST /api/cameras/:id/start`
- `POST /api/cameras/:id/stop`
- `DELETE /api/cameras/:id`
- `GET /api/cameras/:id/preview`
- `GET /api/dashboard`
- `GET /api/stream/:cameraId`
- `GET /api/stream/:cameraId/stats`
- `POST /api/uploads`

### Frontend API Routes

- `GET /api/platform/dashboard`
- `GET /api/platform/cameras`
- `POST /api/platform/cameras`
- `POST /api/platform/cameras/:id/:action`
- `GET /api/platform/cameras/:id/preview`
- `GET /api/platform/socket-token`
- `GET /api/stream/:cameraId`
- `GET /api/stream/:cameraId/stats`
- `POST /api/auth/register`
- `GET/POST /api/auth/[...nextauth]`

### Note

The requested Phase 1 API shape in the prompt is not yet present exactly as written. The current API is compatible but named differently, so wrappers and adapters are the right extension strategy.

## 8. WebSocket Events

### Current Events

- `dashboard:update`
- `camera:update`
- `alert:new`
- `connected`

### Current Socket Model

- Socket connections authenticate with a signed token.
- Each socket joins `user:<userId>`.
- Backend emits user-scoped events only.

### Gap Against Requested Spec

The requested event names like `camera_prediction`, `global_update`, and `dashboard_summary` do not exist yet. They should be added as new events rather than replacing the current ones.

## 9. Database Models

There is no relational database in the current codebase.

Persistence is file-backed JSON:

- `backend/data/cameras.json`
- `backend/data/alerts.json`
- `data/` for shared app persistence

### Camera Shape

Camera records currently store:

- `id`
- `userId`
- `name`
- `zoneName`
- `location`
- `streamUrl`
- `sourceType`
- `status`
- `createdAt`
- `metrics`

### Alert Shape

Alerts currently store:

- `id`
- `userId`
- `cameraId`
- `zoneName`
- `message`
- `risk`
- `count`
- `createdAt`
- `type`

## 10. Data Flow

### Live Data Path

1. Camera URL is saved in backend JSON.
2. Camera starts and the worker manager begins polling.
3. Python service decodes the stream.
4. YOLO finds persons.
5. Tracker maintains identity continuity.
6. CSRNet estimates density when applicable.
7. ConvLSTM predicts future crowd growth.
8. Risk and alert logic summarizes the scene.
9. Backend persists updated metrics and emits websocket events.
10. Frontend renders local and summary analytics.

### Dashboard Aggregation

- Backend dashboard endpoint aggregates cameras and alerts for the user.
- Frontend also computes rankings client-side for fast UI updates.

### Upload Data Path

- Uploads are normalized with ffmpeg.
- The AI service processes the video.
- Results are returned through callback storage.

## 11. Current Problems

- The current AI compatibility wrapper is still named `mockPredict`, which is misleading because it now fronts the Python service.
- `ENABLE_ADVANCED_MODELS` is false by default in `python-service/utils/config.py`, so advanced models may be present but not activated in some runtime paths.
- There are two Python services, which increases architectural complexity.
- Source detection currently treats only `http(s)` and `rtsp` as distinct live camera input types.
- Public live page URLs are not yet resolved into a raw media stream for analytics.
- Global analytics are computed in the dashboard layer, not by a dedicated backend global engine.
- The frontend and backend API names differ from the target spec and need adapter layers if the new naming is required.
- The camera preview pipeline has fallback behavior and may not always produce the same stream mode as the AI pipeline.

## 12. Performance Bottlenecks

- Frame processing is CPU and model heavy, especially for dense scenes.
- CSRNet inference can be expensive on large frames.
- Live stream polling can become expensive with many concurrent cameras.
- File-backed JSON persistence can become a contention point at higher scale.
- The browser overlay draws detections and heatmaps on every repaint, which adds frontend work.
- Multiple live cameras may stress a single Python process if model reuse and concurrency limits are not tuned.

## 13. Extension Points

- `backend/src/services/cameraWorkerManager.js` can grow into a more explicit per-camera worker service.
- `backend/src/services/socketHub.js` can broadcast global analytics events.
- `backend/src/controllers/streamController.js` can be extended with source adapters and better source typing.
- `python-service/utils/crowd_runtime.py` can be extended with camera-specific preprocessing, stronger hybrid switching, and richer metrics.
- `python-service/advanced_models/app.py` can become the canonical live multi-camera AI service.
- `frontend/components/dashboard-shell.js` can host global summary and prediction zones.
- `frontend/components/camera-grid.js` can be reorganized into a strict 3-column live grid.

## 14. Files That Should Never Be Modified

These should be treated as stable or modified only with deliberate compatibility work:

- `python-service/advanced_models/csrnet_final.pth`
- `python-service/advanced_models/lstm_final.pth`
- `python-service/advanced_models/lstm_scaler.pkl`
- `python-service/yolov8n.pt`
- root `yolov8n.pt`
- `backend/data/cameras.json`
- `backend/data/alerts.json`
- auth and secret wiring files unless the security model changes intentionally

## 15. Files That Can Be Extended

- `backend/src/controllers/cameraController.js`
- `backend/src/controllers/streamController.js`
- `backend/src/controllers/dashboardController.js`
- `backend/src/services/cameraWorkerManager.js`
- `backend/src/services/socketHub.js`
- `backend/src/services/aiPredictionService.js`
- `backend/src/config/env.js`
- `python-service/main.py`
- `python-service/utils/crowd_runtime.py`
- `python-service/utils/analytics.py`
- `python-service/utils/config.py`
- `frontend/components/dashboard-shell.js`
- `frontend/components/camera-grid.js`
- `frontend/components/camera-feed.js`
- `frontend/components/camera-form.js`
- `frontend/components/summary-cards.js`
- `frontend/lib/api.js`

## 16. Recommended New Modules

- `backend/src/services/globalAnalyticsEngine.js`
- `backend/src/services/videoSourceService.js`
- `backend/src/services/cameraWorker.js`
- `backend/src/services/predictionAggregator.js`
- `backend/src/types/` or shared schema helpers for metric normalization
- `frontend/components/global-analytics-panel.js`
- `frontend/components/global-prediction-panel.js`
- `frontend/components/camera-source-selector.js`
- `python-service/utils/preprocessing.py`
- `python-service/utils/metrics_fusion.py`
- `python-service/utils/global_summary.py`

## 17. Dependency Graph

```text
frontend/app/dashboard/page.js
  -> frontend/components/dashboard-shell.js
    -> frontend/components/summary-cards.js
    -> frontend/components/camera-form.js
    -> frontend/components/camera-grid.js
    -> frontend/components/camera-feed.js
    -> frontend/components/alerts-panel.js
    -> frontend/components/upload-panel.js

frontend/components/dashboard-shell.js
  -> frontend/lib/api.js
  -> frontend/lib/socket.js
  -> frontend/lib/risk.js

frontend/app/api/platform/*
  -> backend/src/*

backend/src/app.js
  -> backend/src/routes/*
  -> backend/src/controllers/*
  -> backend/src/services/*
  -> backend/src/data/*

backend/src/services/aiPredictionService.js
  -> backend/src/services/aiHttpClient.js
  -> python-service/main.py or python-service/advanced_models/app.py

python-service/main.py
  -> detector.py
  -> tracker.py
  -> utils/crowd_runtime.py
  -> utils/analytics.py
  -> utils/callbacks.py

python-service/utils/crowd_runtime.py
  -> advanced_models/convlstm.py
  -> advanced_models/csrnet.py
  -> detector.py
  -> tracker.py
  -> utils/analytics.py
```

## 18. Execution Flow Diagram

```text
User action
  -> Next.js dashboard
  -> backend platform API
  -> camera repository / dashboard controller
  -> socket broadcast
  -> live camera worker
  -> python AI service
  -> frame capture
  -> preprocessing
  -> YOLO
  -> tracking
  -> CSRNet
  -> ConvLSTM
  -> alert engine
  -> backend metric update
  -> frontend camera card + global summary
```

## 19. Future Scalability

- A dedicated global analytics engine will make it easier to compute venue-wide prediction from per-camera metrics.
- A true per-camera worker abstraction will simplify concurrency and failure isolation.
- A source abstraction layer will make HTTP, RTSP, webcam, and public live URLs uniform.
- Moving from JSON files to a real database will improve data durability and queryability.
- A shared model cache with isolated runtime state per camera will improve scale.
- Global summary and prediction events will make later evacuation modules easier to attach.

## 20. Risk Analysis

- Medium risk: changing stream handling can break live feeds if the fallback path is removed too early.
- Medium risk: enabling advanced models by default can increase latency if the host cannot keep up.
- High risk: replacing the current pipeline would break the user’s requested backward compatibility.
- High risk: changing route names without wrappers would break frontend integration.
- Medium risk: YouTube/public-page ingestion may be unstable unless a raw playable stream is actually available.
- Low risk: adding adapters, additional metrics, and new UI panels while preserving the current routes and workers.

## Summary

The existing system already contains a strong Phase 1 foundation:

- live camera registration
- worker-based live processing
- YOLO detection
- tracking
- CSRNet and ConvLSTM artifacts
- alerting
- dashboard rendering

The main extension work should preserve this flow and add:

- better source normalization
- stronger concurrency boundaries
- explicit global analytics
- richer per-camera metrics
- UI layout improvements
- source adapters for future public live streams
