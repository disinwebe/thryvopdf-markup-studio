# ThryvoPDF Markup Studio

A Windows desktop app for construction/drawing PDFs, in the spirit of Bluebeam: markups, measurements, revision compare and drawing-set organization. Built with Electron, React, TypeScript, Vite, PDF.js (rendering) and pdf-lib (editing).

## Features

- **Viewing**: multiple PDFs in tabs, zoom (buttons, Ctrl+wheel), pan (Pan tool, middle mouse, or hold Space), fit width/page, thumbnails, page navigation (PageUp/PageDown), drag and drop to open.
- **Markups**: highlight, text box, callout, cloud, rectangle, ellipse, line, arrow, polyline, pen, stamps, notes. Color, line width, opacity, fill. Select/move/resize/delete, undo/redo (Ctrl+Z / Ctrl+Y), markup list with filters, status, author, date and comments, CSV export.
- **Saving**: markups are written into the PDF as real annotations (Highlight, FreeText, Square, Circle, Line, PolyLine, Polygon, Ink, Stamp, Text) with appearance streams, so other viewers show them. Full editable data is kept in a private `/PMS` key and restored on reopen.
- **Measurements**: per-page calibration (known distance, or scale such as 1 in = 10 ft, optionally for all pages), length, polylength, area, perimeter, angle, count; units ft/in/m/mm; takeoff table with CSV export.
- **Compare**: choose two PDFs/pages; overlay (removed = red, added = blue, unchanged = gray), ghost and side-by-side modes, tolerance, auto-align plus manual nudge, export as PNG or PDF.
- **Organize**: reorder (drag), rotate, delete, duplicate pages; extract, split, merge, insert pages from another PDF; bookmarks; sheet index (number, title, discipline, revision) with CSV; text search across open documents; project panel for ordering/renaming/merging open sets.

## Usage

```
npm install
npm run build      # type-check + production bundle into dist/
npm start          # build, then launch Electron
npm test           # unit tests (measurement, compare, annotation round-trip, organize)
npm run dist       # NSIS installer in release/
node scripts/make-sample.mjs samples/a.pdf      # sample drawing (add "b" for a revised copy)
```

Shortcuts: Ctrl+O open, Ctrl+S save, Ctrl+Shift+S save as, Delete remove selected, Esc Select tool, Enter / double-click / right-click finish polylines.

## Limitations

- Annotations from other tools (without `/PMS` data) are kept in the file but not displayed or editable here.
- Compare is raster-based (visual differences only).
- The installer is unsigned.

## Accounts

On first launch you register (name, email, discipline, password of 8+ characters); later launches show a sign-in screen. Accounts are local to this PC (stored in the app's userData folder as users.json, passwords hashed with scrypt and a per-user salt). There is no password recovery, no server, and sign-in is required on every launch. The signed-in name is the default markup author; use Logout in the toolbar to switch users.

## Network deployment (shared accounts)

Accounts can live on one central server PC so every client PC shares the same users.

**Server PC**
1. Install Node.js 18+ and copy the `server` folder (single file, no dependencies) to the PC.
2. Run `node server/server.cjs` (or `npm run server` from the repo). Settings (environment variables): `PMS_PORT` (default 8787), `PMS_HOST` (default 0.0.0.0), `PMS_USERS_FILE` (default `server/data/users.json`), `PMS_ADMIN_PASSWORD` (initial admin password, see below), `PMS_SESSION_HOURS` (default 8), `PMS_TLS_KEY` / `PMS_TLS_CERT` (enable HTTPS).
3. Open the firewall for the port (elevated PowerShell): `New-NetFirewallRule -DisplayName "ThryvoPDF Markup Studio" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Domain,Private`
4. To run at startup, use Task Scheduler ("At startup", run `node C:\pms\server\server.cjs` with the variables set) or a service wrapper such as NSSM.
5. Back up the users file regularly.

**Client PCs**: install the app; on first launch enter the server address (e.g. `192.168.1.10:8787`), use *Test connection*, then register or sign in. The address is saved per Windows user; use *Change* on the login screen to edit it. "Use local accounts on this PC only" is an explicit offline fallback with a separate, non-shared account store.

**Security**: the server hashes passwords with scrypt and per-user salt, locks an email+IP for 15 minutes after 5 failed logins, rate-limits registrations, and issues expiring session tokens. Over plain HTTP, passwords and tokens cross the LAN unencrypted: on untrusted networks enable TLS (`PMS_TLS_KEY`/`PMS_TLS_CERT`, certificate trusted by client PCs via the Windows certificate store, address `https://host:8787`). Anyone on the LAN can register (open registration), and the server session is not currently required to open files, which are local.

### Default administrator and approval workflow

- On first start the server creates the administrator account (user name `admin`) if no admin exists. The initial password is `PMS_ADMIN_PASSWORD` if set (8+ characters); otherwise a random one is generated, printed once on the server console and saved to `ADMIN-INITIAL-PASSWORD.txt` next to the users file (delete it after first login). There is no fixed default password. The admin **must change the password at first login**.
- Registration is restricted: a new registration (name, email, discipline, password) is created as *pending* and shows "Awaiting admin approval". Pending, rejected and disabled users cannot sign in and get a clear message.
- Administrators see **Users** (and **Password**) buttons in the toolbar. User management: approve/reject pending, disable/enable, change role (user/admin), reset password (a temporary password is shown once; the user must change it at next login) and delete. Rules are enforced on the server by role; the last active admin and yourself cannot be disabled, demoted or deleted. Disabling, resetting or deleting a user ends their sessions.
- Existing accounts from an earlier server version become active users. Local-account mode has no roles or approval.

## Shared documents (multi-user collaboration)

Available in server mode only; local PDFs and local-account mode work exactly as before.

- **Upload / open**: click **Shared�** in the toolbar. *Upload current tab* stores a copy of the PDF (with its existing markups) on the central server; **Open** loads that server copy into a tab marked with a cloud symbol. Any signed-in, approved user can open any shared document; only the uploader or an administrator can delete it. Uploads must be PDFs (150 MB max).
- **Live sync**: markup additions, edits and deletions are sent to the server a fraction of a second after you make them and appear on every other open copy within about a second. Each markup keeps its author and date. A banner under the tabs shows who is working in the document (name and discipline) and turns amber when you are offline or your session expired (unsynced changes stay in the tab and are retried).
- **Conflicts**: the server is authoritative and applies changes one at a time (each bumps the document version). Markups have unique ids, so simultaneous additions never collide. If two people edit the *same* markup at the same moment, the last change to reach the server wins and replaces the other, so ownership of a markup is not locked.
- **Persistence**: shared PDFs and their markups are stored in `docs/` next to the users file (default `server/data/docs`), one `.pdf` and one `.json` per document. **Back up the whole `server/data` folder** (users + docs).

Limitations: only markups are shared (not scale calibrations, bookmarks or sheet metadata); the shared PDF itself is not modified, so page reorder/rotate/insert are blocked on shared tabs (extract to a local copy first), while Save / Save as writes a local copy with the current markups; sync uses HTTP long-polling, not WebSockets (about 1 s latency, one open request per shared tab); presence expires 45 s after a client stops polling; sessions last 8 h, then sign in again; the server keeps no history/undo of other users' changes; there is no per-document access control; plain HTTP exposes documents on the LAN unless TLS is enabled. Server-side validation rejects malformed markups.
