# SweetyCall Architecture Overview

## 1. System Overview

SweetyCall is a realtime messenger with direct chats and WebRTC calls.

Core stack:
- `apps/api`: NestJS backend (REST + Socket.IO Gateway)
- `apps/web`: Next.js frontend (App Router)
- PostgreSQL: primary data store
- Redis: presence and transient realtime state
- Nginx: reverse proxy in production
- Docker Compose: runtime orchestration

High-level request flow:

1. Browser sends HTTPS requests to Nginx.
2. Nginx routes:
   - `/` to Next.js web app
   - `/api/*` to NestJS API
   - `/api/socket.io/*` to Socket.IO gateway
3. API persists domain data in PostgreSQL and uses Redis for online state.

## 2. Backend Responsibilities (`apps/api`)

NestJS API handles:
- authentication (JWT access/refresh flow)
- user profile and friend management
- direct conversation lifecycle
- message persistence
- unread counters and read state
- realtime gateway events
- call signalling events (offer/answer/ICE/end)

Data persistence:
- Prisma ORM over PostgreSQL for users, friends, conversations, messages.

Transient/realtime state:
- Redis for online presence and socket-related bookkeeping.

## 3. Frontend Responsibilities (`apps/web`)

Next.js client handles:
- auth session bootstrap
- friend search / requests / contacts
- conversation UI and message composer
- realtime event subscription via Socket.IO client
- unread and preview rendering in contact list
- responsive UI (desktop and mobile behavior)
- WebRTC media/call controls

Networking:
- REST over Axios for CRUD and auth flows
- Socket.IO for realtime updates

## 4. Realtime Layer

Realtime endpoint path:

`/api/socket.io`

Socket.IO is used for:
- new message delivery (`message:new`)
- presence updates (`presence:online`, `presence:offline`)
- call signalling (`call:offer`, `call:answer`, `call:ice`, `call:end`, etc.)

Important infra note:
- Nginx must proxy `/api/socket.io` consistently; mismatched path breaks realtime.

## 5. Presence Model

Presence state is derived from active sockets:
- on connect: user is marked online
- on disconnect: user sockets are pruned and state is recalculated

Redis is used to track user socket IDs and broadcast presence transitions to relevant peers.

## 6. Messaging Flow

1. Sender posts a message (REST).
2. API writes message to PostgreSQL.
3. API emits realtime event to participant room(s) via Socket.IO.
4. Receiver updates local cache/UI immediately.
5. Unread counter is incremented unless the target conversation is currently open.
6. When conversation opens, read status is synced via read endpoint + cache update.

## 7. WebRTC Signalling Flow

Media transport:
- peer-to-peer WebRTC media (audio/video)

Signalling transport:
- Socket.IO events through API gateway

Simplified call sequence:
1. Caller sends `call:offer`
2. Callee responds with `call:answer`
3. Both sides exchange `call:ice` candidates
4. Peer connection transitions to connected
5. Camera/mic state changes are synchronized via signalling events
6. Any side can terminate with `call:end`

## 8. Deployment Model

Production runtime:
- VPS (Linux)
- Docker Compose services (`web`, `api`, `postgres`, `redis`, `nginx`)
- TLS termination and reverse proxy in Nginx

Current release process is manual:
1. `git pull`
2. `docker compose up -d --build`
3. health/log checks

## 9. Key Engineering Decisions

- **NestJS + Next.js split**: clean boundary between API and UI concerns.
- **Socket.IO instead of raw WebSocket**: stable event model and reconnect behavior.
- **Redis for presence**: low-latency online state without overloading SQL.
- **REST + realtime hybrid**: reliable persistence via REST, low-latency UX via events.
- **Dockerized runtime**: reproducible local/prod environments.
