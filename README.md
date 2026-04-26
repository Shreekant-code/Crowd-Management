# Crowd Monitoring Platform

Multi-user Phase-1 cloud crowd monitoring platform with:

- `frontend/`: Next.js App Router, Tailwind CSS, NextAuth, Socket.io client
- `backend/`: Express, Socket.io, modular camera workers, RTSP/video ingestion hooks
- `data/`: local JSON persistence for users, cameras, and alerts

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Create env files:

- Copy `backend/.env.example` to `backend/.env`
- Copy `frontend/.env.example` to `frontend/.env.local`

3. Start both apps:

```bash
npm run dev
```

4. Open:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:4000`

## User platform flow

1. Open `http://localhost:3000`
2. Create a free account from `/signup`
3. Login to your own dashboard
4. Add RTSP cameras and start monitoring

Each account gets:

- its own user record
- its own cameras
- its own dashboard summary
- its own alerts

## ffmpeg notes

Video uploads are normalized with `ffmpeg`. Install it and make sure `ffmpeg` is available in your system `PATH`.

Example Windows install:

- `winget install Gyan.FFmpeg`

## Key capabilities

- Public signup and login with NextAuth credentials
- Multi-user isolation for cameras, alerts, and dashboard data
- RTSP camera registration per user
- Start/stop/delete camera APIs with protected backend access
- Worker per camera with mock AI predictions
- Live user-scoped dashboard updates over Socket.io
- Alert stream with rolling history
- Video upload processing pipeline

## Security model

- The browser talks to authenticated Next.js route handlers at `/api/platform/*`
- Those route handlers forward requests to Express with a server-only shared secret
- Express only serves user-scoped data when that trusted context is present
- Socket connections require a signed user token before joining a private room
