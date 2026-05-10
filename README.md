# Pithos

Cloud storage that runs on a Raspberry Pi.

*Named after the πίθος — the large clay storage jar of ancient Greece.*

> **WIP** — will deploy on k3s.

## Goals

Pithos aims to be as lightweight as possible — comfortably runnable on a single Raspberry Pi:

- One Python process, one SQLite database, file bytes on local disk.
- No required external services — no S3, no Postgres, no Redis, no message broker.
- Minimal dependency surface; no heavy runtimes (no JVM, no headless browser).
- Frontend builds to static files; backend is a single ASGI app.

## Features

### File management

- Upload single files, multi-select uploads, or whole folders (directory structure preserved via `webkitGetAsEntry`).
- Drag-and-drop uploads with a per-file conflict prompt: **Overwrite / Overwrite all / Skip / Skip all** (decisions queue across concurrent workers).
- Download individual files, or download whole folders as on-the-fly streamed ZIPs.
- Create folders, rename files and folders, delete (folder deletes cascade to descendants).
- Per-user namespace — every user's files live in their own isolated tree.
- Storage quota: bytes-used reporting per user, with an optional cap.

### In-app viewers

Open files directly in the browser without downloading them first.

- **Images** — PNG, JPG, GIF, WebP, etc., with thumbnail previews in the file grid.
- **PDF** — embedded reader.
- **Video** — native player backed by HTTP `Range` requests, so seeking works on large files without re-downloading.
- **ZIP archives** — browse the contents tree without extracting; navigate nested folders with breadcrumbs.
- **Text / source code** — syntax-highlighted via `highlight.js`, with floating top/bottom scroll buttons.
- **Hex** — offset / hex / ASCII rows for binary files.
- **Markdown** — WYSIWYG editor (MDXEditor) with save back to the source file.
- **"Open as text" / "Open as hex"** fallbacks for unknown file types.

### Workspace UX

- List view and grid view (small / medium / large icon sizes); settings persist in `localStorage` and sync across browser tabs.
- Type-specific coloured icons (image / PDF / video / zip / markdown / generic) in both the file grid and inside the ZIP viewer.
- `..` parent-folder navigation in both the main file grid and the ZIP viewer.
- Viewer mounted as a query-param-driven overlay (`?view=<path>`) so closing it returns you to the same folder URL.

### Accounts & auth

- Self-serve registration and login.
- Passwords hashed with `bcrypt`.
- HMAC-SHA256 signed bearer tokens (short TTL, 30 min default).
- Separate signed view-tokens for inline media — lets `<video>` / `<img>` tags fetch protected content without exposing the bearer token.

## Tech stack

- **Backend** — FastAPI, Python 3, SQLite via `aiosqlite`.
- **Frontend** — React + TypeScript + Vite, Tailwind.

## Roadmap

Tracked in [open issues](https://github.com/sianachi/CloudFileStorage/issues) — includes presigned URLs, content-addressed storage with O(1) rename, Postgres migration, password reset, an end-user CLI, and static-site hosting ("web spaces").
