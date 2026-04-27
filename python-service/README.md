# Python AI Service

This service adds real crowd analytics to the existing Node backend without changing the public API routes or frontend socket payloads.

## What it does

- Accepts a normalized video file path for background analysis
- Starts RTSP camera processing in the background
- Runs `YOLOv8` person detection
- Runs `ByteTrack` tracking
- Produces:
  - `people_count`
  - `detections`
  - `heatmap_points`
  - `alerts`
  - optional `zone_counts`
  - optional `line_crossing`
  - additive future fields like `density_map`, `predicted_crowd`, `risk_score`

## Install

```bash
cd python-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

## Environment

- `YOLO_MODEL=yolov8n.pt`
- `YOLO_CONFIDENCE=0.35`
- `FRAME_SKIP=4`
- `AI_MAX_ACTIVE_JOBS=2`
- `OVERCROWD_THRESHOLD=25`
- `SUDDEN_SPIKE_THRESHOLD=8`
- `ENABLE_ADVANCED_MODELS=false`

## Sample API Calls

Start a file job:

```bash
curl -X POST http://127.0.0.1:8001/jobs/file ^
  -H "Content-Type: application/json" ^
  -d "{\"file_path\":\"C:/videos/clip.mp4\",\"file_id\":\"clip-1\"}"
```

Start a stream:

```bash
curl -X POST http://127.0.0.1:8001/streams/start ^
  -H "Content-Type: application/json" ^
  -d "{\"camera_id\":\"cam-1\",\"stream_url\":\"rtsp://example/cam\"}"
```

Get latest stream result:

```bash
curl http://127.0.0.1:8001/streams/cam-1/latest
```

Stop a stream:

```bash
curl -X POST http://127.0.0.1:8001/streams/stop ^
  -H "Content-Type: application/json" ^
  -d "{\"camera_id\":\"cam-1\"}"
```

## Data Flow

1. Node receives upload or camera start as it already does.
2. `mockPredict()` stays the compatibility entrypoint inside Node.
3. For uploads:
   Node starts `/jobs/file`, returns immediate `processing started`, and falls back to mock analytics if the AI service is unavailable.
4. For RTSP streams:
   Node starts `/streams/start` once, then keeps polling `/streams/{cameraId}/latest` on the existing timer.
5. Node keeps the current dashboard and WebSocket behavior, only with real analytics data when available.

## Future Advanced Models

Current pipeline:

`Detection -> Tracking -> Counting -> Heatmap`

Future extension point:

`Detection -> Tracking -> Counting -> Heatmap`

`                       -> Advanced Models -> Density / Risk Output`

Drop-in modules already exist:

- `advanced_models/convlstm.py`
- `advanced_models/csrnet.py`

Expected additive output shape:

```json
{
  "density_map": [],
  "predicted_crowd": 42,
  "risk_score": 0.67
}
```

Because these fields are additive, Node and the frontend do not need route or socket format changes to adopt them later.
