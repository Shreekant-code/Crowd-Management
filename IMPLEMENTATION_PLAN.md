# Implementation Plan

## Phase 1

### Purpose

Preserve the existing pipeline and extend it into a multi-camera, parallel, source-normalized live analytics system with local per-camera metrics and a separate global analytics summary.

### Modules

- Backend camera source normalization
- Backend per-camera worker isolation
- Backend global analytics aggregation
- Python live stream runtime hardening
- Frontend camera grid and summary layout

### Files

- `backend/src/controllers/cameraController.js`
- `backend/src/controllers/streamController.js`
- `backend/src/services/cameraWorkerManager.js`
- `backend/src/services/socketHub.js`
- `backend/src/services/aiPredictionService.js`
- `backend/src/config/env.js`
- `python-service/utils/crowd_runtime.py`
- `python-service/utils/config.py`
- `python-service/main.py`
- `frontend/components/dashboard-shell.js`
- `frontend/components/camera-grid.js`
- `frontend/components/camera-feed.js`
- `frontend/components/summary-cards.js`
- `frontend/components/camera-form.js`

### Dependencies

- Existing YOLO, tracker, CSRNet, and ConvLSTM code must remain unchanged in behavior.
- The backend live stream proxy must keep working for current HTTP and RTSP sources.
- Socket.IO event names must stay backward compatible.

### Estimated Work

- Medium to large.
- Mostly extension work, but touches the live stream path and dashboard rendering path.

### Testing

- Camera add/start/stop/delete API tests
- Live stream stats tests
- Socket update tests
- Multi-camera parallel smoke test
- Fallback stream test for offline or invalid sources

### Rollback Strategy

- Keep all current routes intact.
- Add wrappers rather than renaming endpoints.
- Preserve existing camera metrics shape.
- If a new source type fails, fall back to the current HTTP/RTSP path.

## Phase 2

### Purpose

Improve accuracy and source support for public live sources while keeping the same AI pipeline:

`Detection -> Tracking -> CSRNet -> ConvLSTM -> Alerts`

### Modules

- Public live source resolver
- Frame preprocessing utilities
- Camera-specific threshold tuning
- Confidence and smoothing improvements

### Files

- `backend/src/utils/ffmpeg.js`
- `backend/src/controllers/streamController.js`
- `backend/src/controllers/cameraController.js`
- `backend/src/services/aiPredictionService.js`
- `python-service/utils/crowd_runtime.py`
- `python-service/advanced_models/csrnet.py`
- `python-service/advanced_models/convlstm.py`
- `python-service/utils/config.py`

### Dependencies

- Phase 1 source abstraction and worker model
- Stable local per-camera metrics
- Global metrics aggregation contract

### Estimated Work

- Medium.
- Requires careful validation against real streams.

### Testing

- Public live URL test
- Dense scene accuracy test
- Low-light camera test
- CPU and latency benchmark

### Rollback Strategy

- Disable the new source resolver by config flag.
- Keep preprocessing changes additive.
- Preserve current fallback counts and risk rules.

## Phase 3

### Purpose

Prepare evacuation and decision support inputs without implementing route planning yet.

### Modules

- Safe-zone data contract
- Global prediction contract
- Decision support input normalizer
- Evacuation-ready event payloads

### Files

- `backend/src/services/globalAnalyticsEngine.js`
- `backend/src/services/predictionAggregator.js`
- `backend/src/services/socketHub.js`
- `frontend/components/global-prediction-panel.js`
- `frontend/components/global-analytics-panel.js`
- `python-service/utils/global_summary.py`

### Dependencies

- Phase 1 local analytics
- Phase 2 accuracy improvements
- Stable per-camera metrics and venue-wide aggregation

### Estimated Work

- Medium.
- Mostly data-contract and UI work.

### Testing

- Global summary completeness test
- Prediction consistency test
- Alert aggregation test

### Rollback Strategy

- Keep evacuation-related data optional.
- Do not alter camera analytics contracts.
- Make new global fields additive only.

