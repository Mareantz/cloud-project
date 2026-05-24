# Restaurant Reviews

An anonymous restaurant-review platform built on Azure.  
**Phase 1 – Project Foundation** (this branch): runnable local skeleton only.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 6 + TypeScript |
| API | Azure Functions v4 (Node.js / TypeScript) |
| Database | Azure Cosmos DB for NoSQL |
| Storage | Azure Blob Storage *(Phase 2)* |
| Observability | Application Insights *(Phase 3)* |
| Hosting | Azure Static Web Apps + Functions |

---

## Prerequisites

### Required to run locally

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 20 LTS | https://nodejs.org |
| **Azure Functions Core Tools** | v4 | `npm install -g azure-functions-core-tools@4 --unsafe-perm true` |

### Required for emulators (local Azure services)

| Tool | Version | Install |
|------|---------|---------|
| **Docker Desktop** | Latest | https://www.docker.com/products/docker-desktop |

Docker Desktop is needed to run Azurite (Storage) and the Cosmos DB emulator via `docker-compose.yml`.  
If you don't need Cosmos DB or Storage yet, you can skip Docker — the API health endpoint has no external dependencies.

### Optional (integration / deployment)

| Tool | Purpose | Install |
|------|---------|---------|
| **SWA CLI** | Run frontend + API together, mimicking production routing | `npm install -g @azure/static-web-apps-cli` |
| **Azure CLI** | Provision and deploy Azure resources | https://learn.microsoft.com/en-us/cli/azure/install-azure-cli |

---

## Local Setup

### 1 — Clone and install dependencies

```bash
git clone <repo-url>
cd cloud-project

# Frontend
cd frontend
npm install

# API
cd ../api
npm install
```

### 2 — Configure environment variables

```bash
# Copy the example file and review each variable
cp .env.example .env
```

The defaults in `.env.example` are pre-filled for the local emulators — no changes needed to get started.

> **Important:** `api/local.settings.json` is already pre-filled with emulator defaults and is excluded from Git (see `.gitignore`).  
> It is committed here for first-run convenience only. Do **not** commit real secrets to this file.

### 3 — Start local Azure emulators (optional but recommended)

```bash
docker compose up -d
```

This starts:
- **Azurite** on ports `10000-10002` – emulates Blob, Queue, and Table Storage  
- **Cosmos DB Emulator** on port `8081` – Data Explorer at https://localhost:8081/_explorer/index.html

> **Note:** The Cosmos DB emulator uses a self-signed TLS certificate.  
> For local API development, you can set `NODE_TLS_REJECT_UNAUTHORIZED=0` in your terminal or in `api/local.settings.json` under `Values`.  
> Never use this setting in production.

---

## Running the Application

### Option A — Two terminals (simplest)

**Terminal 1 — API**

```bash
cd api
npm run dev        # compiles TypeScript then starts func host
```

The Functions host starts on http://localhost:7071.  
Test the health endpoint:

```bash
curl http://localhost:7071/api/health
# {"status":"ok","timestamp":"...","service":"restaurant-reviews-api"}
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev        # starts Vite dev server
```

Open http://localhost:5173 in your browser.  
The page shows **✅ API is reachable** when both processes are running.

---

### Option B — SWA CLI (production-like routing)

SWA CLI runs both the frontend and API through a single gateway (default port 4280), matching the routing behaviour of Azure Static Web Apps.

```bash
# From the repo root (after npm install in both frontend/ and api/):
swa start frontend/dist --api-location api --api-port 7071
```

Or use the dev server for hot-reload:

```bash
swa start http://localhost:5173 --api-location api --api-port 7071 &
cd frontend && npm run dev
```

Open http://localhost:4280.

---

## Project Structure

```
cloud-project/
├── docker-compose.yml          # Azurite + Cosmos DB emulator
├── .env.example                # All anticipated env vars (copy to .env)
├── .gitignore
├── README.md
│
├── frontend/                   # Vite + React + TypeScript
│   ├── package.json
│   ├── vite.config.ts          # Proxies /api → localhost:7071
│   ├── index.html
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx            # React entry point
│       ├── App.tsx             # App shell – polls /api/health
│       └── vite-env.d.ts       # VITE_* env var types
│
└── api/                        # Azure Functions v4 (TypeScript)
    ├── package.json
    ├── host.json               # Functions host configuration
    ├── local.settings.json     # Local env vars (not committed in prod)
    ├── tsconfig.json
    └── src/
        ├── index.ts            # Imports all function modules
        └── functions/
            └── health/
                └── index.ts    # GET /api/health
```

---

## Environment Variables Reference

See `.env.example` for all variables with inline documentation.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `VITE_API_BASE_URL` | Frontend | API base URL for non-proxied environments |
| `AzureWebJobsStorage` | API | Storage connection (use `UseDevelopmentStorage=true` locally) |
| `FUNCTIONS_WORKER_RUNTIME` | API | Must be `node` for the Node.js worker |
| `COSMOS_ENDPOINT` | API *(Phase 2)* | Cosmos DB account endpoint |
| `COSMOS_KEY` | API *(Phase 2)* | Cosmos DB primary key |
| `COSMOS_DATABASE` | API *(Phase 2)* | Database name |
| `AZURE_STORAGE_CONNECTION_STRING` | API *(Phase 2)* | Blob storage connection |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | API *(Phase 3)* | Telemetry pipeline |

---

## Useful Scripts

| Directory | Script | What it does |
|-----------|--------|-------------|
| `frontend/` | `npm run dev` | Start Vite dev server with HMR |
| `frontend/` | `npm run build` | Type-check + production build |
| `frontend/` | `npm run preview` | Serve the production build locally |
| `frontend/` | `npm run typecheck` | Type-check without emitting files |
| `api/` | `npm run dev` | Build then start Functions host |
| `api/` | `npm run build` | Compile TypeScript to `dist/` |
| `api/` | `npm run watch` | Watch mode TypeScript compilation |
| `api/` | `npm run start` | Start Functions host (requires prior build) |
| `api/` | `npm run typecheck` | Type-check without emitting files |

---

## Roadmap

| Phase | Scope |
|-------|-------|
| **1 – Foundation** *(current)* | Project scaffold, health endpoint, emulator setup |
| **2 – Data** | Cosmos DB integration, restaurants + reviews CRUD endpoints |
| **3 – Frontend UI** | Restaurant list, review form, detail pages |
| **4 – Media** | Photo uploads via Blob Storage |
| **5 – Observability** | Application Insights integration |
| **6 – Deployment** | Azure infrastructure provisioning + CI/CD via GitHub Actions |
