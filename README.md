# Zebra Label Designer

A web-based visual designer for Zebra printer labels. Draw labels by dragging elements onto a canvas and inspect or edit the raw ZPL code in a code editor — both views stay in sync at all times. Labels are saved as versioned designs tied to a user account.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Element Types](#element-types)
- [Bidirectional Sync](#bidirectional-sync)
- [Save & Load](#save--load)
- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)

---

## Quick Start

**Requirements:** Node.js >= 18, PostgreSQL running locally.

```bash
# 1. Install all workspace dependencies from the repo root
npm install

# 2. Create a local database
createdb etiqueta_dev

# 3. Set required environment variables for the backend
export DATABASE_URL=postgresql://localhost/etiqueta_dev
export JWT_SECRET=any-random-secret-string

# 4. Start backend (Terminal 1) — runs on http://localhost:3001
npm run dev:backend

# 5. Start frontend (Terminal 2) — runs on http://localhost:5173
npm run dev:frontend
```

The backend runs migrations automatically on first start — no manual SQL needed.

Open [http://localhost:5173](http://localhost:5173), register an account, and start designing.

### With Docker Compose (dev)

If you have Docker, you can skip installing Node and PostgreSQL locally:

```bash
# Start Postgres + backend + frontend (with hot reload) in one command
docker compose up

# Stop everything (add -v to also delete the database volume)
docker compose down
```

Source is mounted into the containers, so edits hot-reload. The frontend is on
[http://localhost:5173](http://localhost:5173) and the backend on
[http://localhost:3001](http://localhost:3001).

---

## Features

### Canvas Designer

- **Drag elements from the sidebar** onto the canvas: Text, Barcode 128, QR Code, Box (rectangle), Line
- **Select and move** elements by dragging them
- **Resize** any element with 8 directional handles (n, s, e, w, ne, nw, se, sw)
- **Type exact values** in the Properties Panel and label size fields (mm, comma or dot as decimal separator): applied on Enter or when leaving the field; ↑/↓ step 0.1 mm (Shift: 1 mm); Esc discards
- **Multi-select** with Shift+click; alignment tools appear in the toolbar when ≥2 elements are selected
- **Duplicate** a selected element with `Ctrl+D` or the button in the Properties Panel (16-dot offset)
- **Z-order controls** — bring forward / backward / to front / to back in the Properties Panel
- **Delete** a selected element with the `Delete` key or the button in the Properties Panel
- **Snap to grid** toggle in the toolbar (8-dot grid)
- **Dot-grid background** that scales with zoom to help with alignment
- **Undo / Redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) — 100-step history tracking elements and label dimensions

**Text is drawn where the printer prints it** (`frontend/src/utils/zplText.ts`):

- Font 0 uses the printer's own character widths, measured from Labelary renders: each character is placed at its printed position (within about 1 dot), with Roboto Condensed Bold glyphs sized to the printed cap height. Other fonts are approximated with the browser font
- `^FO` text starts at the top of the character cell (baseline at 75% of the font height); `^FT` is the baseline (of the last line, in a `^FB` block)
- Text outside a `^FB` block is as big as the printed text: resizing it (handles or W/H) changes the `^A` height and width
- **Align in a fixed width** (Properties Panel, text) turns the text into a `^FB` block: alignment (left / center / right / justified) and max lines; the block width is the element width
- **Corners** (Properties Panel, box) sets the `^GB` corner rounding, from square (0) to Rounded 8
- `^FB` blocks wrap like the printer (at spaces, `\&` forces a break, long words split between characters). Text that needs more lines than the block allows is overprinted on the last line, as the printer does, and the block gets a dashed red outline

### Dynamic Variables

Text, Barcode 128, and QR Code elements can be marked **dynamic** in the Properties Panel. A dynamic element stores a **variable name** (restricted to `[A-Za-z0-9_]`) instead of a fixed value and emits a `{{variableName}}` placeholder into the ZPL `^FD` field.

- The canvas shows the literal `{{variableName}}`; dynamic barcodes/QR codes render a dashed placeholder box
- Parsing ZPL that contains a `{{name}}` field marks the element dynamic — full round-trip
- Variables can also be mixed with fixed text by typing them in the element's Value, e.g. `CONTÉM: {{QTD}} PEÇAS`. The element stays a regular (non-dynamic) element; the canvas tints each `{{name}}` and the Properties Panel lists the variables found
- When **Preview** or **Export** runs on a label with variables (whole-field or mixed with text), a **Sample values** dialog collects an example value per variable and substitutes them before sending to Labelary. The values typed are offered again on the next Preview/Export
- **Show sample values** (above the canvas) draws the sample values in place of the `{{variables}}` — text, barcodes and QR codes — so the layout can be checked with real lengths. Values are still tinted; the ZPL keeps the `{{variables}}`

### ZPL Code Editor

- Monaco-based editor (same engine as VS Code) showing the live ZPL output
- **Edits sync back to the canvas** automatically after a 600ms pause in typing
- **Invalid ZPL** shows a red error banner above the editor without crashing the canvas
- Unknown ZPL commands are ignored gracefully

### Zoom Controls

| Action | Result |
|---|---|
| `−` button | Zoom out by 25% |
| `+` button | Zoom in by 25% |
| Click percentage | Reset to 100% (default) |

Zoom range: 25% – 300%. The displayed percentage uses 2× as the baseline (zoom value 2.0 = 100%).

### Label Dimensions

Set label **width** and **height** in mm via the toolbar. Internally converted to ZPL dots at 8.03 dots/mm (203 DPI). Changing dimensions immediately regenerates the ZPL.

### Labelary Preview & Export

`POST /api/preview` proxies the label to the [Labelary public API](http://labelary.com/service.html) and returns a PNG render. `POST /api/export` returns downloadable output in PNG, PDF, EPL, or ZPL. Preview is cached — if the ZPL hasn't changed since the last preview, no new request is made.

### My Designs page

- Card grid showing all saved designs
- **Search bar** — filter designs by name in real time
- **Inline rename** — click a design name to edit it in place
- Expandable version list per card (lazy-loaded)
- "Open latest" shortcut and per-version load buttons
- Delete (prompts confirmation, cascades to all versions)

---

## Architecture Overview

```
etiqueta_zpl/
├── frontend/          React 18 + Vite + TypeScript + Tailwind + Zustand
└── backend/           Node.js + Express + TypeScript + Drizzle ORM + PostgreSQL
```

**Monorepo** using npm workspaces. `npm install` at the root installs both packages.

**Core principle:** the backend owns all ZPL logic. The frontend never constructs or parses ZPL strings directly — it sends design state to the backend and receives ZPL back.

```
Canvas change
  → POST /api/generate-zpl  (debounced 200ms, previous request cancelled via AbortController)
  → ZPL string written to Monaco editor

Monaco edit (600ms pause)
  → POST /api/parse-zpl     (previous request cancelled via AbortController)
  → elements[] written back to canvas
```

### Key files

| File | Purpose |
|---|---|
| `backend/src/zpl/generator.ts` | `elements[] + dims → ZPL string` |
| `backend/src/zpl/parser.ts` | `ZPL string → elements[] + dims` |
| `backend/src/db/schema.ts` | Drizzle table definitions |
| `backend/src/db/database.ts` | Drizzle client singleton, migrations on startup |
| `frontend/src/store/useDesignerStore.ts` | All designer state (elements, ZPL, zoom, sync logic) |
| `frontend/src/store/useAuthStore.ts` | JWT token + refresh logic |
| `frontend/src/store/useDesignsStore.ts` | Active design / version tracking |

### Tech stack

| Layer | Libraries |
|---|---|
| Frontend | React 18, Vite 5, TypeScript 5.3, Tailwind CSS 3, Zustand |
| Drag-and-drop | `@dnd-kit/core`, `@dnd-kit/utilities` |
| Code editor | `@monaco-editor/react` |
| Barcode / QR | `jsbarcode`, `qrcode` |
| Backend | Express 4, TypeScript, Drizzle ORM, `pg` |
| Auth | `bcryptjs`, `jsonwebtoken` |
| Validation | Zod |
| DB migrations | `drizzle-kit` |
| Tests | Jest + ts-jest |

---

## Element Types

All positions and sizes are stored in **ZPL dots** (203 DPI → 8.03 dots/mm). The Properties Panel displays and accepts values in **mm**.

| Type | Default size (dots) | ZPL command |
|---|---|---|
| `text` | 200 × 40 | `^FO{x},{y}^A{font}N,{size},{size}^FD{value}^FS` |
| `barcode128` | 300 × 100 | `^FO{x},{y}^BY{module}^BCN,{height},Y,N,N^FD{value}^FS` |
| `qrcode` | 100 × 100 | `^FO{x},{y}^BQN,2,{mag}^FDMA,{value}^FS` |
| `rect` | 200 × 100 | `^FO{x},{y}^GB{w},{h},8^FS` |
| `line` | 200 × 8 | `^FO{x},{y}^GB{w},{h},3^FS` |

---

## Bidirectional Sync

### Canvas → Code

Any canvas change triggers `POST /api/generate-zpl` (debounced 200ms). The previous in-flight request is cancelled via `AbortController` before a new one fires, preventing stale responses from corrupting the editor.

### Code → Canvas

Every keystroke calls `onCodeChange`. After a **600ms pause**, it calls `POST /api/parse-zpl`. Same `AbortController` pattern — rapid typing cancels previous requests. Recognized elements replace the canvas state; unknown commands are ignored.

### Infinite-loop prevention

The store maintains a `lastCanvasZpl` sentinel. When the editor receives a value just generated by the canvas, `onCodeChange` returns immediately without triggering a re-parse.

---

## Save & Load

Designs are stored per user in a three-level hierarchy: **user → design → versions**.

| Save mode | When | What happens |
|---|---|---|
| New design | First save, or user chooses "New design" | Creates a design record + version 1 |
| New version | User chooses "New version" | Appends the next incremented version |
| Overwrite | User chooses "Overwrite v{N}" | Replaces the current version's content in-place |

Design names are unique per user. Designs can be renamed inline from the My Designs page.

---

## Authentication

The app uses a **dual-token scheme**:

- **Access token** — short-lived JWT (60 minutes), stored in `localStorage`. Sent as `Authorization: Bearer <token>` on every API request.
- **Refresh token** — long-lived opaque token (30 days), stored as a SHA-256 hash in the database. Delivered and rotated via an `httpOnly` cookie scoped to `/api/auth`. Single-use — each refresh issues a new token and invalidates the old one.

### Flow

1. Login → server returns `{ token }` (access token) + sets `zpl_refresh` httpOnly cookie
2. On page load, if no valid access token is found in localStorage, the client silently calls `POST /api/auth/refresh` using the cookie
3. On any 401 response, the client retries once with a silent refresh; if that also fails, it logs out
4. Logout calls `POST /api/auth/logout` to revoke the refresh token server-side, then clears localStorage

### Security notes

- Passwords are hashed with bcrypt (cost factor 10)
- JWT is signed with `JWT_SECRET` — **keep this value secret and never commit it**
- The server refuses to start if `JWT_SECRET` or `DATABASE_URL` are not set
- CORS is restricted to `FRONTEND_URL`
- All `/api/designs` and ZPL proxy routes require a valid JWT

---

## Environment Variables

### Backend

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string. Example: `postgresql://user:pass@localhost:5432/etiqueta_dev` |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWTs. Generate with `openssl rand -hex 32` |
| `PORT` | No | `3001` | Port for the Express server |
| `FRONTEND_URL` | No | `http://localhost:5173` | Allowed CORS origin. In production set to `http://<server-ip>:3001` |
| `NODE_ENV` | No | `development` | Set to `production` in the Docker image |

---

## API Reference

### Public endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check. Returns `{ ok: true, db: "up" }` or 503 |
| `POST` | `/api/auth/register` | Register. Body: `{ username, password }`. Returns 201 or 409. Limit: 10 requests / 15 min / IP |
| `POST` | `/api/auth/login` | Login. Body: `{ username, password }`. Returns `{ token }`, sets refresh cookie. Limit: 10 **failed** logins / 15 min / IP (successful logins are not counted), then 429 |
| `POST` | `/api/auth/refresh` | Rotate refresh token. Returns `{ token }` or 401. Reads `zpl_refresh` cookie |
| `POST` | `/api/auth/logout` | Revoke refresh token. Clears cookie. Returns 204 |

### Protected endpoints (require `Authorization: Bearer <token>`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/generate-zpl` | Generate ZPL from elements. Returns `{ zpl }` |
| `POST` | `/api/parse-zpl` | Parse ZPL to elements. Returns `{ elements, labelWidth, labelHeight, unknownCommands }` |
| `POST` | `/api/preview` | Proxy to Labelary. Returns PNG binary |
| `POST` | `/api/export` | Export label. Body includes `format: png\|pdf\|epl\|zpl` |
| `GET` | `/api/designs` | List designs (paginated). Query: `?limit=&offset=` |
| `POST` | `/api/designs` | Create new design + version 1 |
| `GET` | `/api/designs/:id` | Get design with version. Add `?version=N` for a specific version |
| `PATCH` | `/api/designs/:id` | Rename design. Body: `{ name }`. Returns 409 if name taken |
| `DELETE` | `/api/designs/:id` | Delete design and all versions |
| `GET` | `/api/designs/:id/versions` | List all versions (summary) |
| `POST` | `/api/designs/:id/versions` | Create a new version |
| `GET` | `/api/designs/:id/versions/:vn` | Get a specific version (full detail with ZPL) |
| `PUT` | `/api/designs/:id/versions/:vn` | Overwrite a specific version |

---

## Database Schema

Four tables, managed by Drizzle migrations (run automatically on startup).

```
users
  id            serial PK
  username      text UNIQUE NOT NULL
  password_hash text NOT NULL
  created_at    timestamp DEFAULT now()

designs
  id         serial PK
  user_id    integer FK → users.id ON DELETE CASCADE
  name       text NOT NULL
  created_at timestamp DEFAULT now()
  updated_at timestamp DEFAULT now()
  UNIQUE(user_id, name)
  INDEX idx_designs_user_id (user_id)

design_versions
  id             serial PK
  design_id      integer FK → designs.id ON DELETE CASCADE
  version_number integer NOT NULL
  zpl            text NOT NULL
  elements_json  jsonb NOT NULL    ← stored as jsonb for server-side validation
  label_width    integer NOT NULL
  label_height   integer NOT NULL
  created_at     timestamp DEFAULT now()
  UNIQUE(design_id, version_number)

refresh_tokens
  id         serial PK
  user_id    integer FK → users.id ON DELETE CASCADE
  token_hash text UNIQUE NOT NULL   ← SHA-256 hex of the raw token
  expires_at timestamp NOT NULL
  created_at timestamp DEFAULT now()
```

### Generating a new migration

If you change `backend/src/db/schema.ts`:

```bash
DATABASE_URL=postgresql://localhost/etiqueta_dev npm run db:generate --workspace=backend
```

The generated SQL file is committed to `backend/drizzle/` and applied automatically on the next server start.

---

## Deployment

The app ships as a single Docker image. The Express server serves the compiled React frontend as static files — no separate web server needed.

### CI/CD

Every merge to `master` triggers a GitHub Actions workflow (`.github/workflows/docker-publish.yml`) that:
1. Builds the production Docker image
2. Pushes two tags to Docker Hub: `:latest` and `:<version from package.json>`

**Required GitHub repository secrets:**
- `DOCKERHUB_USERNAME` — your Docker Hub username
- `DOCKERHUB_TOKEN` — a Docker Hub access token (hub.docker.com → Account Settings → Security)

### Running on a server

Copy `docker-compose.prod.yml` and a `.env` file to the server:

```bash
# .env
DB_PASSWORD=your-postgres-password
DATABASE_URL=postgresql://postgres:your-postgres-password@db:5432/etiqueta_zpl
JWT_SECRET=generate-with-openssl-rand-hex-32
FRONTEND_URL=http://<server-ip>:3001
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts three containers: `db` (Postgres), `backend` (the app), and `watchtower`.

### Automatic updates with Watchtower

[Watchtower](https://containrrr.dev/watchtower/) runs as a sidecar container and polls Docker Hub every 5 minutes. When it detects a new `:latest` digest, it automatically pulls the new image and restarts the backend — no manual server intervention needed.

The full automated deploy flow after a merge to `master`:
```
merge to master
  → GitHub Actions builds + pushes :latest  (~50s)
  → Watchtower detects new digest            (~5 min poll)
  → pulls image + restarts backend           (automatic)
```

---

## Running Tests

Tests live in the backend only and require a running PostgreSQL instance.

```bash
# Create the test database (one-time)
createdb etiqueta_test

# Run all tests
cd backend && npm test
```

Each test suite truncates tables in the correct FK order before each test for isolation.

### What is tested

- **`zpl/generator.test.ts`** — unit tests for each element type's ZPL output, dynamic `{{variable}}` placeholders
- **`zpl/parser.test.ts`** — round-trip tests: `elements → ZPL → elements`; unknown commands do not crash
- **`auth/authService.test.ts`** — register, duplicate username, login, invalid credentials
- **`designs/designsService.test.ts`** — create, list, get, delete designs; versions; ownership isolation

---

## Project Structure

```
etiqueta_zpl/
├── package.json                  # npm workspaces root
├── Dockerfile                    # multi-stage: deps → build → production + dev stages
├── docker-compose.yml            # dev stack (hot reload)
├── docker-compose.prod.yml       # production stack (image from Docker Hub + Watchtower)
├── .github/workflows/
│   └── docker-publish.yml        # CI: build + push to Docker Hub on merge to master
├── frontend/
│   ├── vite.config.ts            # dev server + /api proxy to :3001
│   └── src/
│       ├── App.tsx               # root layout, auth gate, page routing
│       ├── types.ts              # DesignElement type definition
│       ├── store/
│       │   ├── useDesignerStore.ts   # canvas state + sync logic + undo/redo
│       │   ├── useAuthStore.ts       # JWT token + silent refresh
│       │   └── useDesignsStore.ts    # active design/version tracking + rename
│       ├── components/
│       │   ├── Canvas.tsx            # DnD canvas, element renderer
│       │   ├── Sidebar.tsx           # element palette
│       │   ├── Toolbar.tsx           # label size, save/preview/export, logout
│       │   ├── PropertiesPanel.tsx   # element properties, z-order, duplicate
│       │   ├── CodeEditor.tsx        # Monaco ZPL editor
│       │   ├── TabSwitcher.tsx       # Design/Code toggle + zoom controls
│       │   ├── SaveDesignModal.tsx   # save (new/version/overwrite)
│       │   ├── ExportModal.tsx       # export format picker
│       │   ├── PreviewPanel.tsx      # Labelary PNG render panel
│       │   ├── SampleValuesModal.tsx # sample values for dynamic variables
│       │   └── elements/             # per-type visual renderers
│       ├── pages/
│       │   ├── LoginPage.tsx         # register / login form
│       │   └── MyDesignsPage.tsx     # design grid with search + inline rename
│       └── utils/
│           ├── zplClient.ts          # /api/generate-zpl, parse-zpl, preview, export
│           ├── authClient.ts         # /api/auth/* + silent refresh
│           ├── designsClient.ts      # /api/designs/*
│           ├── zplFonts.ts           # Zebra font → CSS family/weight/transform map
│           └── variables.ts          # {{var}} extraction + substitution
└── backend/
    ├── drizzle/                  # generated migration SQL files
    ├── drizzle.config.ts
    └── src/
        ├── index.ts              # startup: env var guards, initDb, listen
        ├── app.ts                # Express app, CORS, helmet, route mounting
        ├── config.ts             # centralised env var exports
        ├── db/
        │   ├── schema.ts         # Drizzle table definitions
        │   ├── database.ts       # singleton client + initDb
        │   └── migrate.ts        # runs drizzle migrations
        ├── zpl/
        │   ├── generator.ts      # elements → ZPL
        │   ├── parser.ts         # ZPL → elements
        │   └── types.ts          # element type definitions
        ├── auth/
        │   └── authService.ts    # bcrypt + JWT + refresh token rotation
        ├── designs/
        │   └── designsService.ts # CRUD for designs and versions
        ├── middleware/
        │   ├── authenticate.ts   # JWT verification
        │   ├── errorHandler.ts   # centralised error handler
        │   └── rateLimit.ts      # auth + proxy rate limiters
        └── routes/
            ├── auth.ts
            ├── designs.ts
            ├── zpl.ts
            └── health.ts
```
