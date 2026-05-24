# Restaurant Reviews — Azure Student Project

An anonymous restaurant-review platform built on Azure.  
This README documents the full project for local development, presentation, and submission.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [What Was Built](#2-what-was-built)
3. [Architecture & Azure Services](#3-architecture--azure-services)
4. [Assignment Requirements Mapping](#4-assignment-requirements-mapping)
5. [Quick Start (Local)](#5-quick-start-local)
6. [Prerequisites](#6-prerequisites)
7. [Local Azure Emulators](#7-local-azure-emulators)
8. [Running the Application](#8-running-the-application)
9. [Seeding Sample Data](#9-seeding-sample-data)
10. [API Reference](#10-api-reference)
11. [Project Structure](#11-project-structure)
12. [Environment Variables Reference](#12-environment-variables-reference)
13. [Useful Scripts](#13-useful-scripts)
14. [Deployment to Azure](#14-deployment-to-azure)
15. [CI/CD — GitHub Actions](#15-cicd--github-actions)
16. [Demo & Presentation Checklist](#16-demo--presentation-checklist)
17. [Assumptions & Design Decisions](#17-assumptions--design-decisions)
18. [Future Improvements](#18-future-improvements)

---

## 1. Project Overview

A full-stack web application where anyone can browse restaurants, submit star-rated reviews, and attach a photo to their review. There is no login — submissions are anonymous by design.

Review images are stored in Azure Blob Storage as full-resolution originals. A 128-px JPEG thumbnail is generated automatically: when an image is uploaded the API enqueues a processing job, and a queue-triggered Azure Function consumes the job to produce the thumbnail asynchronously. Review cards display the thumbnail inline and link to the full-resolution original.

The entire infrastructure is defined as code (Bicep) and deployed to Azure via a GitHub Actions CI/CD pipeline. Local development uses Docker-based Azure emulators so no Azure subscription is needed to run and develop the app.

---

## 2. What Was Built

### Frontend (React + Vite)

Three client-side pages with React Router v6:

| Route              | Page              | Purpose                                                                                 |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------- |
| `/`                | Home              | Lists all restaurants; filterable by city and cuisine                                   |
| `/restaurants/:id` | Restaurant Detail | Shows restaurant info, average rating, all reviews; includes the review submission form |
| `/add`             | Add Restaurant    | Form to create a new restaurant entry with optional photo upload                        |

**Tech:** React 18, TypeScript, Vite 6, React Router v6, `@microsoft/applicationinsights-web` for frontend telemetry.

### Backend (Azure Functions v4)

Nine functions written in TypeScript using the Azure Functions v4 programming model. Seven are HTTP triggers; two handle background work.

**HTTP triggers**

| Function              | Route                                | Purpose                                                                                        |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `health`              | `GET /api/health`                    | Liveness check; polled by the frontend on load                                                 |
| `getRestaurants`      | `GET /api/restaurants`               | List all restaurants, optionally filtered                                                      |
| `createRestaurant`    | `POST /api/restaurants`              | Create a new restaurant                                                                        |
| `getRestaurantById`   | `GET /api/restaurants/{id}`          | Fetch a single restaurant                                                                      |
| `getReviews`          | `GET /api/restaurants/{id}/reviews`  | List reviews for a restaurant, ordered newest-first                                            |
| `createReview`        | `POST /api/restaurants/{id}/reviews` | Submit a review (with optional `imageUrl`/`thumbnailUrl`); updates `averageRating`             |
| `uploadPhoto`         | `POST /api/upload-photo`             | Upload a restaurant cover photo to Blob Storage (max 5 MB)                                    |
| `uploadReviewImage`   | `POST /api/upload-review-image`      | Upload a review photo (max 8 MB); stores the original and enqueues a thumbnail-generation job |

**Queue trigger**

| Function            | Queue                       | Purpose                                                                                                               |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `generateThumbnail` | `review-image-processing`   | Dequeues a job, downloads the original from `review-images`, produces a 128-px JPEG, and writes it to `review-thumbnails` |

### Infrastructure (Bicep + GitHub Actions)

- `infra/main.bicep` — single Bicep template that provisions every Azure resource
- `infra/deploy.sh` — wrapper script (Azure CLI) for one-command provisioning
- `.github/workflows/azure-swa.yml` — CI/CD pipeline: build, test TypeScript, deploy to Azure Static Web Apps on every push to `main`

---

## 3. Architecture & Azure Services

```
Browser
  │
  ▼
Azure Static Web Apps  ──────────────────────────────────────┐
  │  (CDN-hosted React SPA)                                  │
  │  /api/* requests routed to managed Functions             │
  ▼                                                          │
Azure Functions — HTTP triggers (Node.js 20, managed by SWA) │
  ├── Reads/writes ──────────────→ Azure Cosmos DB for NoSQL │
  ├── Reads/writes ──────────────→ Azure Blob Storage        │
  │     ├── restaurant-images    (restaurant cover photos)   │
  │     ├── review-images        (original review photos)    │
  │     └── review-thumbnails    (auto-generated thumbnails) │
  ├── Enqueues job ──────────────→ Azure Storage Queue       │
  │     └── review-image-processing                          │
  └── Emits telemetry ───────────→ Application Insights      │
                                         │                    │
Azure Functions — Queue trigger          │                    │
  └── generateThumbnail                  │                    │
        reads  → review-images (Blob)    │                    │
        writes → review-thumbnails (Blob)│                    │
                                         ▼                    │
                              Log Analytics Workspace ─────────┘
```

| Azure Service               | Role in this project                                                                                                                                                            | SKU / Mode                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Static Web Apps**         | Hosts the React frontend via global CDN; provides a managed Azure Functions runtime for the API (no separate Function App resource needed)                                      | Free                                       |
| **Azure Functions v4**      | REST API — all HTTP endpoints plus one queue-triggered thumbnail worker; runs inside the SWA managed environment                                                                | Node.js 20, managed                        |
| **Cosmos DB for NoSQL**     | Primary database; stores restaurants and reviews (including `imageUrl` / `thumbnailUrl`) as JSON documents                                                                      | Serverless (default) or Free Tier (opt-in) |
| **Blob Storage**            | Three containers: `restaurant-images` (cover photos), `review-images` (original review photos), `review-thumbnails` (auto-generated 128-px JPEG thumbnails); all public-read   | Standard LRS                               |
| **Storage Queue**           | `review-image-processing` queue decouples upload from thumbnail generation; enqueued by `uploadReviewImage`, consumed by the `generateThumbnail` queue-trigger function         | Standard (part of Storage Account)         |
| **Application Insights**    | Captures HTTP request traces, custom events (`review.image.uploaded`, `thumbnail.generated`, `review.created`, `photo.uploaded`, `health.check`), and exceptions from API and frontend | Workspace-based                       |
| **Log Analytics workspace** | Backend log store for Application Insights                                                                                                                                      | Pay-per-GB, 30-day retention               |

### Local equivalents (no Azure subscription required)

| Azure Service           | Local emulator                                             | How it starts               |
| ----------------------- | ---------------------------------------------------------- | --------------------------- |
| Blob Storage            | **Azurite** (Microsoft official emulator)                  | `docker compose up -d`      |
| Storage Queue           | **Azurite** — Queue service on port `10001` (actively used for `review-image-processing`) | `docker compose up -d` |
| Cosmos DB               | **Cosmos DB Linux Emulator**                               | `docker compose up -d`      |
| Static Web Apps routing | **SWA CLI** or Vite proxy                                  | `swa start` / `npm run dev` |
| Application Insights    | Connection string left blank → telemetry silently disabled | No emulator needed          |

---

## 4. Assignment Requirements Mapping

> This section maps the project to the typical Azure student assignment requirement of **using at least 3 distinct Azure services** with clear justification for each.

| Requirement                             | Service Used                                    | Where it is used                                                                 | Evidence in code                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Service 1 — Hosting / Compute**       | Azure Static Web Apps + managed Azure Functions | Hosts the React SPA and all API endpoints                                        | `infra/main.bicep` (`Microsoft.Web/staticSites`); `staticwebapp.config.json`; `.github/workflows/azure-swa.yml`                                        |
| **Service 2 — Database**                | Azure Cosmos DB for NoSQL                       | Persists every restaurant and review document (incl. `imageUrl`/`thumbnailUrl`)  | `api/src/shared/cosmosClient.ts`; `infra/main.bicep` (`Microsoft.DocumentDB/databaseAccounts`); all CRUD functions under `api/src/functions/`          |
| **Service 3 — Object Storage**          | Azure Blob Storage                              | Three containers: restaurant cover photos, original review images, auto-generated thumbnails | `api/src/shared/blobClient.ts`; `api/src/functions/uploadPhoto/`, `uploadReviewImage/`, `generateThumbnail/`; `infra/main.bicep`            |
| **Service 4 — Asynchronous Processing** | Azure Storage Queue                             | Decouples review-image upload from thumbnail generation; `uploadReviewImage` enqueues, `generateThumbnail` consumes | `api/src/functions/uploadReviewImage/index.ts`; `api/src/functions/generateThumbnail/index.ts`; `infra/main.bicep` (`Microsoft.Storage/storageAccounts/queueServices/queues`) |
| **Service 5 — Observability**           | Application Insights                            | Tracks custom events (`review.image.uploaded`, `thumbnail.generated`, etc.), HTTP dependencies, and exceptions | `api/src/shared/telemetry.ts`; `frontend/src/main.tsx`; `infra/main.bicep` (`Microsoft.Insights/components`)                       |
| **Service 6 — Log Management**          | Log Analytics workspace                         | Backs Application Insights (workspace-based); retains all telemetry for querying | `infra/main.bicep` (`Microsoft.OperationalInsights/workspaces`)                                                                                        |
| **Bonus — IaC**                         | Bicep                                           | All six services above are defined declaratively; fully repeatable deployment    | `infra/main.bicep`, `infra/parameters.json`, `infra/deploy.sh`                                                                                         |
| **Bonus — CI/CD**                       | GitHub Actions                                  | Automated build and deploy on every push to `main`; PR preview environments     | `.github/workflows/azure-swa.yml`                                                                                                                      |

**Minimum requirement met:** 6 Azure services used (Static Web Apps, Azure Functions, Cosmos DB, Blob Storage, Storage Queue, Application Insights).

> **Assignment alignment:** the review-image pipeline specifically demonstrates event-driven / asynchronous cloud architecture — a common advanced requirement. `uploadReviewImage` (HTTP trigger) writes to Blob Storage **and** enqueues a message; `generateThumbnail` (Queue trigger) reacts to that message to produce a derived artefact. This is a textbook producer/consumer pattern using two distinct Azure services (Blob Storage + Storage Queue) coordinated by a serverless function pair.

---

## 5. Quick Start (Local)

This is the fastest path from a fresh clone to a running app.

```bash
# 1 — Install dependencies (run once)
#     The api install also downloads the local Azure Functions Core Tools binary.
cd frontend && npm install
cd ../api && npm install
cd ..

# 2 — Start emulators (Docker must be running)
docker compose up -d
# Wait ~30 seconds for the Cosmos DB emulator to be ready

# 3 — Seed sample restaurants and reviews
cd api && npm run seed && cd ..

# 4 — Start the API (Terminal 1)
cd api && npm run dev
# Compiles TypeScript then starts the Functions host on http://localhost:7071

# 5 — Start the frontend (Terminal 2)
cd frontend && npm run dev
# Vite dev server starts on http://localhost:5173
```

Open **http://localhost:5173** — you should see a list of sample restaurants.

> **Windows note:** the commands above work in PowerShell, Git Bash, and WSL.  
> `docker compose` (v2 syntax, no hyphen) requires Docker Desktop 3.6+ or Docker Engine 20.10+.  
> If you see **`'func' is not recognized`**, make sure you are running `npm run dev`  
> (not `func start` directly) and that you have run `npm install` inside the `api/` folder.  
> The `func` binary lives in `api/node_modules/.bin/` and is invoked automatically by the npm script.

---

## 6. Prerequisites

### Required to run locally

| Tool               | Version | Install                                                               |
| ------------------ | ------- | --------------------------------------------------------------------- |
| **Node.js**        | 20 LTS  | https://nodejs.org                                                    |
| **Docker Desktop** | Latest  | https://www.docker.com/products/docker-desktop (needed for emulators) |

> **Azure Functions Core Tools (`func`) — no global install needed.**  
> `azure-functions-core-tools` v4 is a devDependency of the API package.  
> Running `cd api && npm install` installs the `func` binary locally into  
> `api/node_modules/.bin/`. The `npm run dev` script resolves it automatically,  
> so the `'func' is not recognized` error Windows users sometimes encounter  
> **does not occur** when using `npm run dev` instead of calling `func` directly.

### Required only for Azure deployment

| Tool          | Install                                                 |
| ------------- | ------------------------------------------------------- |
| **Azure CLI** | https://learn.microsoft.com/cli/azure/install-azure-cli |
| **SWA CLI**   | `npm install -g @azure/static-web-apps-cli`             |

> Bicep CLI is bundled with Azure CLI ≥ 2.20. Run `az bicep install` to ensure it is available.

---

## 7. Local Azure Emulators

The `docker-compose.yml` at the repo root starts two containerised Azure service emulators:

```bash
# Start both emulators in the background
docker compose up -d

# Stop without deleting data
docker compose down

# Stop and wipe all persisted data
docker compose down -v
```

| Emulator                     | Port(s)                                          | Replaces                          | Notes                                                                                             |
| ---------------------------- | ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Azurite**                  | `10000` (Blob), `10001` (Queue), `10002` (Table) | Azure Blob Storage + Storage Queue | Blob used for all image containers; Queue used by `review-image-processing` for thumbnail jobs  |
| **Cosmos DB Linux Emulator** | `8081`                                           | Azure Cosmos DB for NoSQL         | Data Explorer: https://localhost:8081/\_explorer/index.html — accept the self-signed cert warning |

**Self-signed certificate:** The Cosmos DB emulator issues its own TLS certificate. `api/local.settings.json` already sets `NODE_TLS_REJECT_UNAUTHORIZED=0` to suppress validation errors locally. Never use this setting in production.

**Memory:** The Cosmos DB emulator container is limited to 3 GB RAM (`mem_limit: 3g` in `docker-compose.yml`). On machines with less than ~6 GB free RAM the emulator may be slow to start.

---

## 8. Running the Application

### Option A — Two terminals (simplest, recommended for development)

**Terminal 1 — API**

```bash
cd api
npm run dev        # TypeScript compile → func start (uses local node_modules/.bin/func)
```

The Functions host starts on **http://localhost:7071**.

> **Windows — `'func' is not recognized`?**  
> This means you either ran `func start` directly (bypassing npm) or skipped `npm install`.  
> Fix: run `npm install` once inside `api/`, then use `npm run dev` — never call `func` directly.  
> A global Azure Functions Core Tools installation is **not** required.

Verify the API is up:

```bash
curl http://localhost:7071/api/health
# Expected: {"status":"ok","timestamp":"...","service":"restaurant-reviews-api"}
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev        # Vite dev server with HMR
```

Open **http://localhost:5173**.

The Vite dev server proxies all `/api/*` requests to `http://localhost:7071` (configured in `frontend/vite.config.ts`), so the frontend and API behave identically to production routing without needing SWA CLI.

---

### Option B — SWA CLI (production-like routing, single port)

SWA CLI runs the frontend and API behind a single gateway on port `4280`, exactly matching how Azure Static Web Apps routes requests in production. Use this when you need to validate routing behaviour before deploying.

```bash
# Start the API first (leave it running)
cd api && npm run dev &

# Start the frontend dev server and SWA gateway
swa start http://localhost:5173 --api-location api --api-port 7071
```

Open **http://localhost:4280**.

---

### Understanding `dev`, `start`, and `watch`

These three `api/` scripts are often confused. Here is exactly what each one does:

| Script          | Defined as                          | What it does                                                                 |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`   | `npm run build && func start`       | Compiles TypeScript **once**, then starts the Functions host. **Use this for normal development.** |
| `npm run start` | `func start`                        | Starts the Functions host only — skips compilation. Requires `dist/` to already exist from a prior `npm run build`. |
| `npm run watch` | `tsc --watch`                       | TypeScript compiler in watch mode — recompiles `src/` to `dist/` on every save. **Does not start the Functions host.** |

**`npm run watch` does not restart the Functions host.** The host launched by `func start` does not automatically reload when the compiled output in `dist/` changes. After TypeScript recompiles, you must stop and restart `npm run start` in the second terminal to load the new code.

#### Two-terminal watch-mode workflow

Use this when you want continuous TypeScript compilation during active API development and don't want to wait for a full `npm run dev` cycle each time:

```bash
# Terminal 1 — TypeScript compiler (watches src/ and recompiles to dist/ on save)
cd api
npm run watch

# Terminal 2 — Functions host (start once; restart manually after each recompile)
cd api
npm run start
```

> **Typical cycle:** edit a source file → TypeScript recompiles (Terminal 1 shows "Found 0 errors") → press `Ctrl+C` in Terminal 2 → run `npm run start` again to reload the updated `dist/` output.
>
> For most development sessions, a single `npm run dev` in one terminal (no watch mode) is simpler and equally fast unless you are iterating on a specific function very rapidly.

---

## 9. Seeding Sample Data

After starting the emulators, seed the local Cosmos DB with 4 sample restaurants and 8 reviews:

```bash
cd api
npm run seed
```

What the seed script does:

- Reads connection config from `api/local.settings.json` automatically
- Creates the `restaurant-reviews` database and both containers if they do not exist
- Upserts 4 restaurants (cities: Seattle and Portland) and 8 reviews using fixed UUIDs
- Is safe to rerun — all writes use `upsert`, so no duplicates are created

> **Why not `npm run build node dist\src\shared\seed.js`?**  
> That is not valid npm syntax. Running `npm run build node dist\src\shared\seed.js` only
> executes the `build` script (`tsc`); npm does not treat the extra tokens as a second
> command to run — they are silently ignored, and the seed script never executes.  
> Always use `npm run seed`. It is defined in `api/package.json` as
> `npm run build && node dist/src/shared/seed.js`, so it compiles TypeScript first and
> then runs the compiled seed file in one step.

> **If you see a TLS/certificate error:** the Cosmos DB emulator container is not fully started yet. Wait 30–60 seconds after `docker compose up -d` and try again.

---

## 10. API Reference

All endpoints are served under the `/api` prefix. Every response is a JSON object using the envelope `{ "data": ... }` on success or `{ "error": "..." }` on failure.

### `GET /api/health`

Returns a liveness confirmation. No dependencies on Cosmos DB or Storage.

**Response `200`**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "restaurant-reviews-api"
}
```

---

### `GET /api/restaurants`

Returns all restaurants, ordered by name. Supports optional query-string filters.

**Query parameters**

| Parameter | Type   | Description                                      |
| --------- | ------ | ------------------------------------------------ |
| `city`    | string | Filter to restaurants in this city (exact match) |
| `cuisine` | string | Filter by cuisine type (exact match)             |

**Response `200`**

```json
{ "data": [ { "id": "...", "name": "...", "cuisine": "...", "city": "...", "address": "...", "averageRating": 4.2, "photoUrl": "...", "createdAt": "..." }, ... ] }
```

---

### `POST /api/restaurants`

Creates a new restaurant.

**Request body**

```json
{
  "name": "Sakura Ramen",
  "cuisine": "Japanese",
  "address": "123 Main St",
  "city": "Seattle",
  "photoUrl": "https://..." // optional — omit if no photo yet
}
```

**Response `201`** — the created restaurant document including generated `id` and `averageRating: 0`.

**Response `400`** — missing required fields or invalid `photoUrl`.

---

### `GET /api/restaurants/{id}`

Fetches a single restaurant by its UUID.

**Response `200`** — the restaurant document.  
**Response `404`** — no restaurant with that id exists.

---

### `GET /api/restaurants/{id}/reviews`

Returns all reviews for a restaurant, ordered by creation date descending (newest first).

**Response `200`**

```json
{
  "data": [
    {
      "id": "...",
      "restaurantId": "...",
      "authorName": "...",
      "rating": 5,
      "text": "...",
      "imageUrl": "https://...blob.core.windows.net/review-images/...",
      "thumbnailUrl": "https://...blob.core.windows.net/review-thumbnails/...",
      "createdAt": "..."
    },
    ...
  ]
}
```

`imageUrl` and `thumbnailUrl` are only present when an image was attached to the review.

**Response `404`** — parent restaurant does not exist.

---

### `POST /api/restaurants/{id}/reviews`

Submits a new review. After creation, automatically recalculates and updates `averageRating` on the parent restaurant.

**Request body**

```json
{
  "authorName": "Alex",
  "text": "Excellent broth, highly recommend.",
  "rating": 5,
  "imageUrl": "https://...",      // optional — URL returned by POST /api/upload-review-image
  "thumbnailUrl": "https://..."   // optional — URL returned by POST /api/upload-review-image
}
```

| Field          | Type   | Constraints                                          |
| -------------- | ------ | ---------------------------------------------------- |
| `authorName`   | string | Required, non-empty                                  |
| `text`         | string | Required, non-empty                                  |
| `rating`       | number | Required, integer 1–5 inclusive                      |
| `imageUrl`     | string | Optional; must be a string when present              |
| `thumbnailUrl` | string | Optional; must be a string when present              |

**Response `201`** — the created review document.  
**Response `400`** — missing fields, invalid rating, or non-string image URL.  
**Response `404`** — parent restaurant does not exist.

---

### `POST /api/upload-photo`

Uploads a restaurant **cover photo** to Blob Storage and returns its public URL. The URL can then be passed as `photoUrl` when creating a restaurant.

**Request:** `multipart/form-data` with a single field named `photo`.

| Constraint     | Value                                                |
| -------------- | ---------------------------------------------------- |
| Max file size  | 5 MB                                                 |
| Accepted types | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |

**Response `200`**

```json
{
  "data": {
    "url": "https://<storage-account>.blob.core.windows.net/restaurant-images/<uuid>.jpg"
  }
}
```

**Response `400`** — missing field, empty file, file too large, or unsupported content type.

---

### `POST /api/upload-review-image`

Uploads a **review image** to Blob Storage and enqueues a thumbnail-generation job. Returns both the original URL and the expected thumbnail URL immediately — the thumbnail becomes available once the `generateThumbnail` queue-trigger function processes the job (typically within seconds).

**Request:** `multipart/form-data` with fields:

| Field      | Type   | Description                                                    |
| ---------- | ------ | -------------------------------------------------------------- |
| `image`    | File   | Required — the review photo                                    |
| `reviewId` | string | Optional — used as a blob path prefix to group related images  |

| Constraint     | Value                                                |
| -------------- | ---------------------------------------------------- |
| Max file size  | 8 MB                                                 |
| Accepted types | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |

**Response `200`**

```json
{
  "data": {
    "imageUrl":     "https://<storage>.blob.core.windows.net/review-images/<reviewId>/<uuid>.jpg",
    "thumbnailUrl": "https://<storage>.blob.core.windows.net/review-thumbnails/<reviewId>/<uuid>.jpg"
  }
}
```

Store both URLs in the `createReview` request body. The thumbnail URL resolves to a 128 × auto-height JPEG once the background worker completes.

**Response `400`** — missing `image` field, empty file, file too large, or unsupported content type.

---

## 11. Project Structure

```
cloud-project/
├── .github/
│   └── workflows/
│       └── azure-swa.yml            # CI/CD: build + deploy on push to main
├── docker-compose.yml               # Azurite (Blob + Queue) + Cosmos DB emulator
├── staticwebapp.config.json         # SWA routing rules + API runtime (node:20)
├── .env.example                     # All env vars with documentation (copy to .env)
├── .gitignore
├── README.md
│
├── infra/
│   ├── main.bicep                   # All Azure resources in one Bicep template
│   ├── parameters.json              # Default parameter values (appName, location, etc.)
│   └── deploy.sh                    # Azure CLI wrapper: creates RG, validates, deploys
│
├── frontend/                        # React 18 + Vite 6 + TypeScript
│   ├── vite.config.ts               # Proxies /api → localhost:7071 in dev
│   └── src/
│       ├── App.tsx                  # Router: /, /restaurants/:id, /add
│       ├── main.tsx                 # Entry point; initialises Application Insights
│       ├── pages/
│       │   ├── HomePage.tsx         # Restaurant listing + city/cuisine filters
│       │   ├── RestaurantDetailPage.tsx  # Detail view + reviews + review form
│       │   └── AddRestaurantPage.tsx     # Create restaurant + photo upload
│       ├── components/
│       │   ├── ReviewForm.tsx       # Review form — name, rating, text, optional image upload
│       │   ├── ReviewCard.tsx       # Displays review; shows thumbnail linked to original image
│       │   └── ...                  # Navbar, RestaurantCard, LoadingSpinner, ErrorMessage, StarRating
│       ├── services/
│       │   └── api.ts               # Typed fetch wrappers for all API endpoints
│       └── styles/                  # CSS modules / global styles
│
└── api/                             # Azure Functions v4 (TypeScript)
    ├── host.json                    # Functions host config
    ├── local.settings.json          # Local env vars — emulator defaults, committed intentionally
    └── src/
        ├── index.ts                 # Imports all function modules (registers with runtime)
        ├── shared/
        │   ├── types.ts             # Restaurant, Review (with imageUrl/thumbnailUrl), ApiResponse<T>
        │   ├── cosmosClient.ts      # Lazy singleton Cosmos DB client + container accessors
        │   ├── blobClient.ts        # BlobServiceClient; helpers for restaurant-images, review-images, review-thumbnails
        │   ├── telemetry.ts         # Application Insights trackEvent / trackException helpers
        │   ├── validation.ts        # requireFields(), validateRating()
        │   └── seed.ts              # Local seed script (npm run seed)
        └── functions/
            ├── health/index.ts
            ├── getRestaurants/index.ts
            ├── createRestaurant/index.ts
            ├── getRestaurantById/index.ts
            ├── getReviews/index.ts
            ├── createReview/index.ts          # Persists imageUrl + thumbnailUrl when provided
            ├── uploadPhoto/index.ts           # Restaurant cover photo → restaurant-images blob
            ├── uploadReviewImage/index.ts     # Review image → review-images blob + enqueues job
            └── generateThumbnail/index.ts     # Queue trigger: resizes original → review-thumbnails blob
```

---

## 12. Environment Variables Reference

`api/local.settings.json` is the source of truth for local API config and is committed to the repository (it contains only emulator defaults — the Cosmos DB emulator key is a publicly-known constant — so there are no real secrets here).  
`.env.example` documents the complete set of variables — copy it to `.env` for reference, but the API reads directly from `local.settings.json` when running locally.

> **No manual configuration required after cloning.** The committed `local.settings.json` already points at the Azurite and Cosmos DB emulators started by `docker compose up -d`, including `NODE_TLS_REJECT_UNAUTHORIZED=0` to trust the emulator's self-signed certificate. Do not copy these settings to production.

### API variables (`api/local.settings.json` / Azure App Settings in production)

| Variable                                | Local default                | Purpose                                           |
| --------------------------------------- | ---------------------------- | ------------------------------------------------- |
| `AzureWebJobsStorage`                   | `UseDevelopmentStorage=true` | Functions runtime storage (Azurite locally)       |
| `FUNCTIONS_WORKER_RUNTIME`              | `node`                       | Must be `node`                                    |
| `COSMOS_ENDPOINT`                       | `https://localhost:8081`     | Cosmos DB endpoint                                |
| `COSMOS_KEY`                            | _(well-known emulator key)_  | Cosmos DB auth key                                |
| `COSMOS_DATABASE`                       | `restaurant-reviews`         | Database name                                     |
| `COSMOS_CONTAINER_RESTAURANTS`          | `restaurants`                | Container for restaurant documents                |
| `COSMOS_CONTAINER_REVIEWS`              | `reviews`                    | Container for review documents                    |
| `NODE_TLS_REJECT_UNAUTHORIZED`          | `0`                          | Trusts emulator self-signed cert — **local only** |
| `BLOB_CONNECTION_STRING`                | `UseDevelopmentStorage=true` | Blob + Queue Storage connection (Azurite locally) |
| `BLOB_CONTAINER_NAME`                   | `restaurant-photos`          | Blob container for restaurant cover photos        |
| `REVIEW_IMAGES_CONTAINER_NAME`          | `review-images`              | Blob container for original review images         |
| `REVIEW_THUMBNAILS_CONTAINER_NAME`      | `review-thumbnails`          | Blob container for auto-generated thumbnails      |
| `REVIEW_IMAGES_QUEUE_NAME`              | `review-image-processing`    | Storage Queue for thumbnail generation jobs       |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | _(blank)_                    | API telemetry — leave blank locally               |

### Frontend variables (Vite build-time, `.env`)

| Variable                                     | Purpose                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`                          | API base URL for non-proxied environments (unused when Vite proxy is active) |
| `VITE_APPLICATIONINSIGHTS_CONNECTION_STRING` | Baked into the JS bundle at build time; blank disables frontend telemetry    |

### Production app settings (set automatically by Bicep)

The Bicep template wires all required settings directly onto the Static Web App — no manual portal configuration needed after `deploy.sh` runs.

| App setting                             | Source                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| `FUNCTIONS_WORKER_RUNTIME`              | Hardcoded `node`                                        |
| `AzureWebJobsStorage`                   | Storage Account connection string (via `listKeys()`)    |
| `COSMOS_ENDPOINT`                       | Cosmos DB account endpoint (from deployment output)     |
| `COSMOS_KEY`                            | Cosmos DB primary master key (via `listKeys()`)         |
| `COSMOS_DATABASE`                       | Parameter value (`restaurant-reviews`)                  |
| `COSMOS_CONTAINER_RESTAURANTS`          | Parameter value (`restaurants`)                         |
| `COSMOS_CONTAINER_REVIEWS`              | Parameter value (`reviews`)                             |
| `BLOB_CONNECTION_STRING`                | Storage Account connection string                       |
| `BLOB_CONTAINER_NAME`                   | Parameter value (`restaurant-images`)                   |
| `REVIEW_IMAGES_CONTAINER_NAME`          | Parameter value (`review-images`)                       |
| `REVIEW_THUMBNAILS_CONTAINER_NAME`      | Parameter value (`review-thumbnails`)                   |
| `REVIEW_IMAGES_QUEUE_NAME`              | Parameter value (`review-image-processing`)             |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights connection string (from deployment output) |

---

## 13. Useful Scripts

| Directory   | Script              | What it does                                                               |
| ----------- | ------------------- | -------------------------------------------------------------------------- |
| `frontend/` | `npm run dev`       | Start Vite dev server with HMR on port 5173                                |
| `frontend/` | `npm run build`     | TypeScript check + Vite production build → `frontend/dist/`                |
| `frontend/` | `npm run preview`   | Serve `frontend/dist/` locally to verify the production build              |
| `frontend/` | `npm run typecheck` | Type-check only, no output files                                           |
| `api/`      | `npm run dev`       | Compile TypeScript **once** + start Functions host on port 7071 — use this for normal development |
| `api/`      | `npm run build`     | Compile TypeScript to `api/dist/` only (no host started)                   |
| `api/`      | `npm run watch`     | TypeScript watch mode — recompiles `src/` on save; **does not start the Functions host** |
| `api/`      | `npm run start`     | Start Functions host only — requires `dist/` to exist from a prior `npm run build` |
| `api/`      | `npm run seed`      | Build (`tsc`) + run `dist/src/shared/seed.js` against the local Cosmos DB emulator |
| `api/`      | `npm run typecheck` | Type-check only, no output files                                           |

> **`dev` vs `start` vs `watch` in one line:**  
> `dev` = build + host (normal use) · `start` = host only (post-build) · `watch` = compiler only (pairs with `start` in a second terminal)  
> See [§8 Understanding dev, start, and watch](#understanding-dev-start-and-watch) for the full two-terminal workflow.

---

## 14. Deployment to Azure

### Step 1 — Log in to Azure CLI

```bash
az login
az account set --subscription "<your subscription name or ID>"
```

### Step 2 — Provision infrastructure

```bash
# Optional: edit infra/parameters.json to change appName, location, or enableCosmosFreeTier
bash infra/deploy.sh
```

The script:

1. Creates the resource group (`rg-restreviews` by default, overridable via env vars)
2. Validates the Bicep template
3. Deploys all Azure resources (~3–8 minutes)
4. Prints the Static Web App hostname and deployment token when done

**Windows users:** run in Git Bash or WSL. All `az` commands also work natively in PowerShell — see `infra/deploy.sh` for the equivalent individual commands.

You can override defaults without editing `parameters.json`:

```bash
AZURE_RESOURCE_GROUP=rg-myapp \
AZURE_LOCATION=eastus \
APP_NAME=myapp \
bash infra/deploy.sh
```

| Variable               | Default          | Description                                                                                      |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `AZURE_RESOURCE_GROUP` | `rg-restreviews` | Resource group name                                                                              |
| `AZURE_LOCATION`       | `australiaeast`  | Azure region                                                                                     |
| `APP_NAME`             | `rr`             | 2–8 character prefix for all resource names                                                      |
| `COSMOS_FREE_TIER`     | `false`          | `true` to enable Cosmos DB Free Tier (one per subscription; not compatible with serverless mode) |

### Step 3 — Deploy the application

The deploy script provisions infrastructure only. Push the built app with the SWA CLI:

```bash
cd frontend && npm run build && cd ..
swa deploy frontend/dist \
  --api-location api \
  --deployment-token '<token printed by deploy.sh>'
```

Alternatively, set up the GitHub Actions CI/CD pipeline (see §15) and every push to `main` deploys automatically.

### Provisioned resources

| Resource                | Name pattern                | Purpose                                                                         |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Static Web App          | `swa-<appName>`             | Hosts React frontend + managed Functions API                                    |
| Cosmos DB account       | `cosmos-<appName>-<suffix>` | NoSQL database                                                                  |
| Cosmos DB database      | `restaurant-reviews`        | Application database                                                            |
| Cosmos DB container     | `restaurants`               | Restaurant documents (partition: `/city`)                                       |
| Cosmos DB container     | `reviews`                   | Review documents with `imageUrl`/`thumbnailUrl` fields (partition: `/restaurantId`) |
| Storage Account         | `st<appName><suffix>`       | Functions runtime storage + all blob containers + processing queue              |
| Blob container          | `restaurant-images`         | Publicly-readable restaurant cover photo uploads                                |
| Blob container          | `review-images`             | Publicly-readable original review image uploads                                 |
| Blob container          | `review-thumbnails`         | Publicly-readable auto-generated 128-px JPEG thumbnails                         |
| Storage Queue           | `review-image-processing`   | Job queue — consumed by the `generateThumbnail` function trigger                |
| Application Insights    | `appi-<appName>`            | Telemetry and live metrics                                                      |
| Log Analytics workspace | `log-<appName>`             | Backend for Application Insights                                                |

`<suffix>` is a 6-character hash of the resource group ID — names are globally unique and stable across re-deployments to the same resource group.

### Estimated cost

| Resource                       | Cost                                            |
| ------------------------------ | ----------------------------------------------- |
| Static Web App (Free tier)     | **$0/month**                                    |
| Cosmos DB serverless           | ~$0 for light dev/test (billed per RU consumed) |
| Storage Account (Standard LRS) | < $0.10/month for small datasets                |
| Application Insights           | First 5 GB/month ingestion free                 |
| Log Analytics                  | First 5 GB/month ingestion free                 |

> A typical student project with light traffic costs **under $1/month** with default settings.

### Live URL

The deployed URL is generated by Azure at provision time and follows the pattern:  
`https://<auto-generated-name>.azurestaticapps.net`

The exact hostname is printed by `deploy.sh` at the end of provisioning and is visible in the Azure portal under the Static Web App resource → **URL**. There is no fixed URL to document here — it depends on your subscription and chosen `APP_NAME`.

---

## 15. CI/CD — GitHub Actions

The workflow at `.github/workflows/azure-swa.yml` builds and deploys the app automatically.

### Triggers

| Trigger                       | What happens                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Push to `main`                | Full build → deploy to the **production** Static Web App URL                             |
| Pull request opened / updated | Full build → deploy to a **temporary preview URL** (Azure posts the URL as a PR comment) |
| Pull request closed / merged  | Azure deletes the temporary preview environment automatically                            |

### Build pipeline steps

1. Checkout repository (`actions/checkout@v4`)
2. Set up Node.js 20 with `npm` cache keyed on both lock files
3. `npm ci && npm run build` in `frontend/` → produces `frontend/dist/`
4. `npm ci && npm run build` in `api/` → compiles TypeScript to `api/dist/`
5. `Azure/static-web-apps-deploy@v1` uploads the pre-built output (`skip_app_build: true`, `skip_api_build: true`)

### Required GitHub secret

| Secret                 | Value                                    | Where to find it                                                                                                                                                                                |
| ---------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SWA_DEPLOYMENT_TOKEN` | Deployment token for your Static Web App | Azure portal → Static Web App → **Manage deployment token**; or `bash infra/deploy.sh` (printed at end); or `az staticwebapp secrets list --name <swa-name> --query "properties.apiKey" -o tsv` |

### Optional GitHub secret

| Secret                                       | Effect                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `VITE_APPLICATIONINSIGHTS_CONNECTION_STRING` | Injects the App Insights connection string at Vite build time; omit or leave blank to disable frontend telemetry |

### One-time setup

```bash
# 1. Provision Azure resources
bash infra/deploy.sh

# 2. Add the deployment token as a GitHub secret:
#    Repository → Settings → Secrets and variables → Actions → New repository secret
#    Name:  SWA_DEPLOYMENT_TOKEN
#    Value: <paste the token from deploy.sh output>

# 3. Push a commit to main — the workflow runs automatically.
```

---

## 16. Demo & Presentation Checklist

Use this list when preparing your live demo or screen recording.

### Local demo (no Azure subscription required)

- [ ] Docker Desktop is running; `docker compose up -d` has been run and the Cosmos DB emulator is ready (check https://localhost:8081/\_explorer/index.html loads)
- [ ] `cd api && npm run seed` completed successfully (shows "Seed complete" in the terminal)
- [ ] API is running: `cd api && npm run dev` — terminal shows `Functions Runtime Version: 4.x` and the function list (including `generateThumbnail` — the queue trigger)
- [ ] Verify health endpoint responds: `curl http://localhost:7071/api/health`
- [ ] Frontend is running: `cd frontend && npm run dev`
- [ ] **Show Home page** (http://localhost:5173) — restaurant cards load from Cosmos DB emulator
- [ ] **Demonstrate city/cuisine filter** — filter by "Seattle" or "Italian" and confirm results change
- [ ] **Show Restaurant Detail page** — click a card; reviews and average rating are displayed in reverse chronological order (newest first)
- [ ] **Submit a review without an image** — fill in name, rating, and text; submit; the new review appears at the top and average rating updates
- [ ] **Submit a review with an image** — attach a JPG or PNG using the Photo field; observe "Uploading image…" while `POST /api/upload-review-image` runs; submit the review; the review card shows the thumbnail inline
- [ ] **Verify thumbnail generation** — check the API terminal logs for `generateThumbnail – complete`; the thumbnail URL in the review card should resolve to the 128-px JPEG written to the `review-thumbnails` Azurite container
- [ ] **Click the review thumbnail** — confirm it links to the full-resolution original in the `review-images` Azurite container
- [ ] **Add a restaurant** — navigate to `/add`; fill in the form; optionally upload a cover photo; submit; restaurant appears on the Home page

### Azure deployment demo

- [ ] Show the Static Web App resource in the Azure portal (Overview tab with the generated URL)
- [ ] Open the live URL in a browser — the app loads from the Azure CDN
- [ ] Show the Cosmos DB account in the portal → Data Explorer → `restaurant-reviews` database → `reviews` container → confirm documents contain `imageUrl` and `thumbnailUrl` fields
- [ ] Show the Storage Account → Containers → `review-images` → confirm original review photos are present
- [ ] Show the Storage Account → Containers → `review-thumbnails` → confirm 128-px thumbnails exist at matching blob paths
- [ ] Show the Storage Account → Queues → `review-image-processing` → explain the producer/consumer flow
- [ ] Show Application Insights → **Live Metrics** or **Transaction search** — demonstrate `review.image.uploaded` and `thumbnail.generated` custom events flow when you submit a review with a photo
- [ ] Show Log Analytics workspace → **Logs** → run a simple query (e.g. `AppTraces | limit 10`) to show telemetry data
- [ ] Show GitHub Actions → the last successful workflow run → expand each step to show build and deploy logs
- [ ] Show `infra/main.bicep` briefly — highlight that all six resources (including the queue and three blob containers) are defined in one file

### Code walk-through points

- [ ] `api/src/functions/uploadReviewImage/index.ts` — show the five-step flow: validate → upload original to `review-images` → derive thumbnail URL → enqueue job → return both URLs
- [ ] `api/src/functions/generateThumbnail/index.ts` — show the queue trigger registration (`app.storageQueue`), the `sharp` resize pipeline, and the write to `review-thumbnails`
- [ ] `api/src/functions/createReview/index.ts` — show that `imageUrl` and `thumbnailUrl` are accepted as optional fields and persisted on the review document
- [ ] `frontend/src/components/ReviewForm.tsx` — show the optional photo field that calls `uploadReviewImage` before `createReview`
- [ ] `frontend/src/components/ReviewCard.tsx` — show that `thumbnailUrl` is preferred over `imageUrl` as `<img src>`, and the thumbnail wraps a link to the full-size original
- [ ] `api/src/shared/blobClient.ts` — show the `uploadReviewImageBlob()` helper and `getReviewThumbnailsContainerClient()`
- [ ] `api/src/shared/telemetry.ts` — show `trackEvent()` and `trackException()` wrappers
- [ ] `infra/main.bicep` — show the `reviewImagesQueue`, `reviewImagesContainer`, and `reviewThumbnailsContainer` resources alongside `swaAppSettings`
- [ ] `.github/workflows/azure-swa.yml` — show the two-job structure (build/deploy + PR cleanup)

---

## 17. Assumptions & Design Decisions

**Authentication is out of scope.** All API endpoints use `authLevel: 'anonymous'`. Reviews are attributed by a free-text `authorName` field — there is no identity verification. This is intentional for a student project demo.

**Serverless Cosmos DB by default.** The Bicep template deploys Cosmos DB in serverless mode, which bills per request unit rather than provisioning fixed throughput. This minimises cost for sporadic dev/test workloads. The `enableCosmosFreeTier` parameter switches to 400 RU/s provisioned throughput if you already have a free-tier Cosmos DB account and want to use it.

**`api/local.settings.json` is committed.** Normally this file is git-ignored because it can contain real secrets. In this project it only contains well-known Cosmos DB emulator defaults (the emulator key is a public constant) and is committed deliberately so the project runs without any configuration after cloning. The `.gitignore` entry for it has been removed intentionally.

**Review image pipeline is asynchronous by design.** `POST /api/upload-review-image` returns the `thumbnailUrl` immediately — before the thumbnail exists — so the frontend can persist both URLs on the review document in one `createReview` call. The thumbnail becomes available once `generateThumbnail` processes the queue message (typically within a few seconds locally). This is intentional: it keeps the HTTP upload fast and demonstrates a producer/consumer pattern. `ReviewCard` handles the pre-ready state gracefully by falling back to `imageUrl` if the thumbnail hasn't been written yet and the image element resolves normally once the CDN/blob serves the file.

**Blob container name differs between local and production for restaurant cover photos.** The local emulator uses `restaurant-photos` (set in `local.settings.json`), while the Bicep template provisions a container named `restaurant-images`. Both values land in `BLOB_CONTAINER_NAME` — the code creates the container on first use (`createIfNotExists()`), so both environments work. The review-image containers (`review-images`, `review-thumbnails`) and the queue name are consistent between local and production. The `restaurant-photos` / `restaurant-images` inconsistency should be standardised in a follow-up.

**No CORS restriction in local development.** `api/local.settings.json` sets `CORS: "*"` for convenience. The production Static Web Apps environment handles CORS at the platform level; this setting has no effect there.

**Single-region deployment.** The Bicep template deploys all resources to one Azure region (default: `australiaeast`). No geo-redundancy or failover is configured — appropriate for a student project but not production-grade.

**SWA manages the Functions runtime.** Rather than deploying a separate Azure Function App resource, the API is hosted inside the Static Web App's managed Functions environment. This simplifies deployment and eliminates the need for a separate `Microsoft.Web/sites` resource, but it limits supported runtime configurations compared to a standalone Function App.

**Application Insights is optional for local development.** When `APPLICATIONINSIGHTS_CONNECTION_STRING` is blank, the `telemetry.ts` helper silently no-ops all `trackEvent()` and `trackException()` calls. The app works fully without it locally.

---

## 18. Future Improvements

| Area                      | Improvement                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication**        | Add Azure Static Web Apps built-in auth (GitHub / AAD / Google) so reviews can be attributed to verified users and duplicate submissions prevented                            |
| **Input validation**      | Move validation logic into a shared schema library (e.g. Zod) used by both the API and frontend                                                                               |
| **Pagination**            | Add `continuationToken`-based pagination to `GET /api/restaurants` and `GET /api/restaurants/{id}/reviews` for large datasets                                                 |
| **Thumbnail polling**     | Add a small polling or WebSocket mechanism in `ReviewCard` so the thumbnail image refreshes automatically the moment the queue worker completes, rather than relying on a page reload |
| **Blob container naming** | Standardise `BLOB_CONTAINER_NAME` to the same value (`restaurant-images`) in both `local.settings.json` and `parameters.json` to remove the local/production inconsistency   |
| **Environment isolation** | Add separate `staging` and `production` parameter files; use GitHub Environments to gate production deploys with a manual approval step                                       |
| **Tests**                 | Add unit tests for the validation helpers and integration tests for the HTTP functions using `azure-functions-core-tools` test runner or Jest with mocked Cosmos/Blob clients |
| **Soft delete**           | Implement soft-delete (a `deleted` flag) for restaurants and reviews rather than hard-deleting documents, to preserve audit history                                           |
