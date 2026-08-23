# Edge-Accelerated Crowd Monitoring & Surge Forecasting Platform

An enterprise-grade, edge-optimized crowd monitoring and predictive safety platform engineered specifically for modern integrated APUs (**AMD Ryzen 5 7520U** & **AMD Radeon 610M**).

By completely decoupling high-speed raw video transport from neural network processing and inverting the communication pipeline to a **Push-over-Polling architecture**, this platform decodes, tracks, forecasts, and visualizes 4 concurrent 1080p surveillance streams in real time with ultra-low hardware overhead.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     HARDENED 5-PHASE EDGE ARCHITECTURE                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

   RTSP Surveillance Cameras (x4 Streams @ 1080p 30 FPS)
             │
             ├───► [ PHASE 1: MediaMTX WebRTC Gateway ] ───► Native WHEP Stream (<300ms Video Latency)
             │                                                          │
             ▼                                                          ▼
   [ PHASE 2: GStreamer D3D11 VCN Ingestion ]               [ PHASE 5: HTML5 Canvas Overlay ]
     • Hardware H.264 decompression (AMD VCN)                 • 60 FPS Track-ID LERP Gliding
     • In-VRAM Decimation to 2 FPS (videorate)                • Sub-pixel letterbox/pillarbox alignment
     • In-VRAM Letterboxing (d3d11convert)                    • Dynamic density heatmaps
             │                                                          ▲
             ▼                                                          │
   [ PHASE 3: ONNX DirectML Batched Engine ]                            │ Socket.IO Events
     • DirectX 12 GPU acceleration (Radeon 610M)                        │ (camera:update, dashboard:update)
     • Batched Head Detection (Batch=4 in 94ms)                         │
     • Dynamic Sub-Batching to MobileCount Density                      │
             │                                                          │
             ▼                                                          │
   [ PHASE 4: 1D Temporal Trend Forecaster ]                            │
     • Closed-form polynomial regression (0.021ms)                      │
     • 10-Minute surge risk & velocity modeling                         │
             │                                                          │
             ▼                                                          │
   [ PUSH CADENCE PIPELINE: BatchedStreamManager ]                      │
     • Consolidated 2 FPS Telemetry Push ───────────────────────────────┘
       POST /internal/telemetry/batch ➔ Express Backend ➔ Next.js Frontend
```

---

## Key Hardware Optimizations

| Architecture Layer | Technology / Implementation | Hardware Target & Rationale |
| :--- | :--- | :--- |
| **Video Gateway (Phase 1)** | **MediaMTX** (Go Router) | **CPU ($<1\%$ load):** Decouples RTSP video from Node.js and feeds low-latency WebRTC (WHEP) directly to browsers. |
| **Hardware Ingestion (Phase 2)** | **GStreamer D3D11** (`d3d11h264dec`) | **AMD Radeon VCN:** Decompresses 1080p H.264 and decimates frame rate to 2 FPS directly in GPU memory before CPU RAM transfer. |
| **AI Inference (Phase 3)** | **ONNX Runtime (DirectML)** | **AMD Radeon 610M (DirectX 12):** Executes batched ($B=4$) YOLOv8n Head Detection & MobileCount in FP16 Native in $\sim 94\text{ ms}$. |
| **Cadence Pipeline** | **Push-over-Polling Dispatch** | **Zero Polling Lock:** Python dictates a steady 2 FPS cadence and pushes a single consolidated JSON payload to Express. |
| **1D Forecasting (Phase 4)** | **CrowdForecaster** (Ridge Regression) | **Analytical NumPy Math ($0.021\text{ ms}$):** Extrapolates 10-minute crowd surges with EMA flicker suppression and zero PyTorch overhead. |
| **UI Telemetry Sync (Phase 5)** | **Track-ID LERP Engine** | **60 FPS Canvas Rendering:** Smoothly glides bounding boxes across animation frames ($\alpha = 0.22$) without target swapping. |

---

## 5-Phase Technical Breakdown

### 1. Decoupled Video Delivery with MediaMTX & WebRTC (Phase 1)
- Eliminates heavy Node.js video proxying and ffmpeg transcoding loops.
- Ingests RTSP streams and exposes WebRTC WHEP endpoints at `http://localhost:8889/{camera_id}/whep`.
- Frontend [`whep-client.js`](frontend/lib/whep-client.js) awaits local ICE candidate gathering completion and incorporates React 19 Strict Mode double-mount teardown protection.

### 2. Hardware-Accelerated RTSP Ingestion with GStreamer (Phase 2)
- Implements [`gst_ingestor.py`](python-service/utils/gst_ingestor.py) using Direct3D 11 hardware plugins on Windows.
- Pipeline order: `rtspsrc ! rtph264depay ! h264parse ! d3d11h264dec ! videorate (2 FPS) ! d3d11convert (640x640) ! d3d11download ! appsink`.
- Placing `videorate` immediately after `d3d11h264dec` ensures the AMD GPU scales only 2 frames per second. Zero native memory leaks via explicit buffer unmapping.

### 3. DirectML AI Inference Engine & Head Detection (Phase 3)
- Implements [`dml_engine.py`](python-service/inference/dml_engine.py) binding to AMD Radeon 610M via `DmlExecutionProvider` with pre-compiled compute shaders.
- [`batched_detector.py`](python-service/inference/batched_detector.py) performs vectorized boolean masking (`preds[4, :] > 0.25`) to eliminate 99% of empty candidate anchors prior to NMS.
- **Dynamic Sub-Batch Routing:** Evaluates pairwise head overlap per stream. Only cameras exceeding $>35\%$ overlap trigger sub-batched MobileCount density estimation.

### 4. 1D Temporal Surge Forecasting (Phase 4)
- Implements [`forecaster.py`](python-service/advanced_models/forecaster.py), replacing legacy 2D ConvLSTM with a precomputed pseudo-inverse matrix $\mathbf{M} = (\mathbf{X}^T \mathbf{X} + \alpha \mathbf{I})^{-1} \mathbf{X}^T$.
- Eliminates all PyTorch weight checkpoints and pickle scalers.
- Applies Exponential Moving Average ($\beta = 0.7$) to suppress single-frame detection jitter and calculates 10-minute surge risk (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) in **$0.021\text{ ms}$**.

### 5. UI Telemetry Synchronization & Hardware Verification (Phase 5)
- Tracks each detection by unique `track_id` from ByteTrack to prevent bounding box crisscrossing.
- Implements a 60 FPS requestAnimationFrame LERP loop on HTML5 Canvas in [`camera-feed.js`](frontend/components/camera-feed.js), bridging 30 FPS video with 2 FPS telemetry.
- Computes dynamic letterbox/pillarbox offsets for both `contain` and `cover` viewport modes.

---

## Performance Benchmarks (AMD Ryzen 5 7520U & Radeon 610M)

| Metric | Target Constraint | Measured Benchmark | Status |
| :--- | :--- | :--- | :--- |
| **CPU Utilization (4 Concurrent Streams)** | $\le 55\%$ | **$13.9\% - 40.8\%$** | **PASSED** |
| **DirectML Batch=4 Latency** | $< 150\text{ ms}$ | **$94.9\text{ ms}$** effective per camera | **PASSED** |
| **1D Temporal Forecaster Latency** | $< 0.200\text{ ms}$ | **$0.021\text{ ms}$ ($21.0\ \mu\text{s}$)** | **PASSED ($9.5\times$ headroom)** |
| **WebRTC Video Latency** | $< 300\text{ ms}$ | **$< 250\text{ ms}$ (Native H.264 WHEP)** | **PASSED** |
| **Canvas Bounding Box Smoothness** | $\ge 30\text{ FPS}$ | **$60\text{ FPS}$ LERP Interpolated** | **PASSED** |
| **Full Workspace Production Build** | 0 errors | **$7.1\text{s}$ (Next.js 16 + Express)** | **PASSED** |

---

## Directory Structure

```
Crowd-Management/
├── backend/                        # Node.js & Express REST/Socket.IO Service
│   ├── src/
│   │   ├── controllers/            # Telemetry & Camera Controllers
│   │   ├── data/                   # JSON DB Repositories (Cameras, Alerts)
│   │   ├── services/               # SocketHub, MediaGateway, CameraWorkerManager
│   │   └── app.js                  # Express Routes & Telemetry Ingestion
│   └── package.json
├── frontend/                       # Next.js 16 (React 19) Dashboard UI
│   ├── components/                 # CameraFeed, CameraGrid, Analytics Panels
│   ├── lib/                        # WHEP Client, Stream Manager, Socket Client
│   └── package.json
├── gateway/                        # MediaMTX WebRTC / RTSP Gateway
│   ├── mediamtx.exe                # MediaMTX Standalone Binary
│   └── mediamtx.yml                # Gateway Configuration
├── python-service/                 # DirectML AI Inference & Ingestion Service
│   ├── advanced_models/            # CrowdForecaster 1D Trend Engine
│   ├── inference/                  # DirectML Engine, Batched Detector, Model Exporter
│   ├── models/                     # ONNX Models (YOLOv8n-Head, MobileCount)
│   ├── utils/                      # BatchedStreamManager, GstIngestor, Analytics
│   ├── main.py                     # FastAPI Endpoints & Lifecycle Manager
│   └── requirements.txt
├── scripts/                        # Automated Benchmark & Stress Test Suites
│   └── stress_test_4stream.py      # 4-Stream Hardware Profiler
├── run_services.ps1                # PowerShell All-in-One Service Launcher
└── run_services.bat                # Windows Batch Service Launcher
```

---

## Getting Started & Installation

### Prerequisites
- **Operating System:** Windows 10/11 64-bit (DirectX 12 enabled).
- **Node.js:** v18.0.0 or higher.
- **Python:** v3.10 to v3.12 (with virtual environment created at `.venv`).
- **GStreamer:** MSVC 64-bit runtime installed with Direct3D11 plugins (`gstreamer-1.0-msvc-x86_64-*.msi`).

### 1. Repository Setup

```powershell
# Clone the repository
git clone https://github.com/Shreekant-code/Crowd-Management.git
cd Crowd-Management

# Install Node.js dependencies across backend and frontend workspaces
npm install
```

### 2. Python Environment Setup

```powershell
# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Install Python requirements (DirectML, ONNX, OpenCV, FastAPI, etc.)
pip install -r python-service/requirements.txt
```

---

## Running the Platform

### Option A: Launch All Services (Recommended)

Run the unified PowerShell startup script from the root directory:

```powershell
./run_services.ps1
```

This launches all 4 services concurrently in dedicated processes:
- **MediaMTX WebRTC Gateway:** `http://localhost:8889` (WHEP), `rtsp://localhost:8554` (RTSP), `http://localhost:9997` (API)
- **Python AI Engine (DirectML):** `http://localhost:8001`
- **Express Backend API:** `http://localhost:4000`
- **Next.js Frontend Dashboard:** `http://localhost:3000`

---

### Option B: Launch Services Individually

#### 1. Start MediaMTX Gateway
```powershell
.\gateway\mediamtx.exe .\gateway\mediamtx.yml
```

#### 2. Start Python DirectML Service
```powershell
cd python-service
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

#### 3. Start Express Backend
```powershell
npm --workspace backend run dev
```

#### 4. Start Next.js Frontend
```powershell
npm --workspace frontend run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to access the live dashboard.

---

## Running Hardware Stress Tests

To run the automated 4-stream hardware stress test and benchmark CPU/RAM performance:

```powershell
& .venv/Scripts/python.exe scripts/stress_test_4stream.py 30
```

---

## API Endpoints Reference

### Python AI Service (`http://localhost:8001`)
- `POST /stream/start` — Registers a camera stream and initializes GStreamer D3D11 hardware ingestion.
- `POST /stream/stop` — Deregisters a camera stream and releases its GStreamer pipelines.
- `GET /stream/{camera_id}/stats` — Returns the latest telemetry and 10-minute surge prediction.
- `GET /health` — Service health and DirectML engine status.

### Express Backend (`http://localhost:4000`)
- `POST /internal/telemetry/batch` — Receives consolidated 2 FPS telemetry from Python and emits Socket.IO updates.
- `GET /api/cameras` — Lists all registered cameras and latest analytics.
- `GET /api/dashboard` — Aggregated venue metrics, alerts, and risk levels.
- `GET /api/health` — Backend health check.

---

## License

This project is licensed under the MIT License.
