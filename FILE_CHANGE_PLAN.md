# File Change Plan

| File | Purpose | Modify? | Create? | Delete? | Reason | Risk Level |
|---|---|---:|---:|---:|---|---|
| `backend/src/controllers/cameraController.js` | Add source typing and preserve camera CRUD flow | Yes | No | No | Needed for source normalization and camera metadata extension | Medium |
| `backend/src/controllers/streamController.js` | Route live streams and stats through source adapters | Yes | No | No | Core place to keep HTTP/RTSP/public source handling compatible | High |
| `backend/src/services/cameraWorkerManager.js` | Per-camera live worker orchestration | Yes | No | No | Best place to extend multi-camera isolation and metrics aggregation | High |
| `backend/src/services/socketHub.js` | Broadcast global analytics events | Yes | No | No | Needed for new dashboard events without breaking existing ones | Medium |
| `backend/src/services/aiPredictionService.js` | Python service orchestration | Yes | No | No | Add source-aware stream startup and reuse current compatibility layer | Medium |
| `backend/src/config/env.js` | Add feature flags and service URLs | Yes | No | No | Required for source resolver and phase flags | Low |
| `backend/src/controllers/dashboardController.js` | Add global analytics response shape | Yes | No | No | Central backend dashboard aggregation point | Medium |
| `backend/src/data/cameraRepository.js` | Persist extra camera metadata if needed | Yes | No | No | Support source type and health fields | Medium |
| `backend/src/data/alertRepository.js` | Keep alert persistence compatible | No | No | No | Already sufficient unless schema grows | Low |
| `backend/src/utils/ffmpeg.js` | Extend stream normalization and preview handling | Yes | No | No | Useful for public live URL handling and fallback streaming | High |
| `python-service/main.py` | Keep primary AI service compatible | Yes | No | No | Add source normalization and safe runtime improvements | High |
| `python-service/utils/crowd_runtime.py` | Core AI pipeline orchestration | Yes | No | No | Required for camera-level metrics and phase-1 behavior | High |
| `python-service/utils/analytics.py` | Crowd metrics and risk computation | Yes | No | No | Good extension point for stable per-camera analytics | Medium |
| `python-service/utils/config.py` | Thresholds and feature flags | Yes | No | No | Central tuning point for accuracy and latency | Low |
| `python-service/advanced_models/csrnet.py` | CSRNet wrapper | Yes | No | No | Add preprocessing and dense-scene tuning only | Medium |
| `python-service/advanced_models/convlstm.py` | Temporal prediction wrapper | Yes | No | No | Keep model intact, improve history use and outputs | Medium |
| `python-service/advanced_models/app.py` | Advanced live runtime service | Yes | No | No | Candidate for canonical live camera processing path | High |
| `frontend/components/dashboard-shell.js` | Dashboard layout and global panels | Yes | No | No | Needed for summary placement and global prediction panel | Medium |
| `frontend/components/camera-grid.js` | Per-camera card layout | Yes | No | No | Needed for 3-column grid and local analytics display | Medium |
| `frontend/components/camera-feed.js` | Live feed overlay and status | Yes | No | No | Needed to show better live metrics without changing backend flow | Medium |
| `frontend/components/camera-form.js` | Camera source input UX | Yes | No | No | Add source type selection while keeping current input flow | Medium |
| `frontend/components/summary-cards.js` | Global top-level counts | Yes | No | No | Extend to include venue-level analytics fields | Low |
| `frontend/components/alerts-panel.js` | Alert visibility | No | No | No | Already fits current alert stream | Low |
| `frontend/lib/api.js` | Frontend API helper | Yes | No | No | Add wrappers for any new global endpoints | Low |
| `frontend/lib/socket.js` | Socket auth and connection | No | No | No | Current socket client is sufficient | Low |
| `frontend/app/dashboard/page.js` | Dashboard composition | No | No | No | Keep page shell stable | Low |
| `frontend/app/api/platform/cameras/[id]/[action]/route.js` | Backend action wrapper | No | No | No | Current route should stay backward compatible | Low |
| `frontend/app/api/platform/cameras/[id]/preview/route.js` | Preview proxy | No | No | No | Keep route stable and only extend backend behavior if needed | Low |
| `frontend/app/api/platform/dashboard/route.js` | Dashboard proxy | No | No | No | Current route is fine | Low |
| `frontend/app/api/stream/[cameraId]/route.js` | Live stream proxy | No | No | No | Keep stable while backend stream logic grows | Low |
| `frontend/app/api/stream/[cameraId]/stats/route.js` | Live stats proxy | No | No | No | Keep stable while backend metrics grow | Low |
| `python-service/advanced_models/csrnet_final.pth` | Model artifact | No | No | No | Must not be edited | High |
| `python-service/advanced_models/lstm_final.pth` | Model artifact | No | No | No | Must not be edited | High |
| `python-service/advanced_models/lstm_scaler.pkl` | Model artifact | No | No | No | Must not be edited | High |
| `python-service/yolov8n.pt` | Model artifact | No | No | No | Must not be edited | High |
| `yolov8n.pt` | Root model artifact | No | No | No | Must not be edited | High |
| `backend/data/cameras.json` | Stored camera state | No | No | No | Do not delete or reset during extension | High |
| `backend/data/alerts.json` | Stored alerts | No | No | No | Do not delete or reset during extension | High |

