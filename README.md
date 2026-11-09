# ThryvoPDF Markup Studio

A Windows desktop app for construction/drawing PDFs: markups, measurements, revision compare and drawing-set organization. Built with Electron, React, TypeScript, Vite, PDF.js (rendering) and pdf-lib (editing).

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

- External annotations are displayed with PDF.js; their text comments appear read-only in the Markups panel for the current page. Rendering depends on PDF.js support and available appearance data. Rich-text formatting and editing external annotations are not supported.
- Compare is raster-based (visual differences only).
- The installer is unsigned.

## Accounts

On first launch you register (name, email, discipline, password of 8+ characters); later launches show a sign-in screen. Accounts are local to this PC (stored in the app's userData folder as users.json, passwords hashed with scrypt and a per-user salt). There is no password recovery, no server, and sign-in is required on every launch. The signed-in name is the default markup author; use Logout in the toolbar to switch users.

## Network deployment (shared accounts)

To host from the desktop app, choose **Set up this PC as a server** on the connection screen, or **Option > Server setup** after signing in. Choose a port and data folder, then start the server and copy a LAN address to other PCs. The server runs only while the app remains open and the PC is awake; it is not installed as a Windows service or started automatically. If this is a new server, the initial admin password is stored in `ADMIN-INITIAL-PASSWORD.txt` in the data folder: read it privately, change it at first login, and delete the file. Changing the data folder switches databases and does not migrate files. Back up the entire data folder before changes.

**ThryvoPDF Server Manager** is a separately installed Windows application for running the same server as an automatic-start Windows service, independently of both desktop applications. Install the manager, choose a local data folder and port, then explicitly confirm **Install service** and approve Windows elevation; use **Start**, **Stop**, and **Restart** to control it. The service runs as Windows LocalService. Installing grants LocalService inherited Modify access to the chosen folder and its contents; use a dedicated folder, restrict other access, and verify any existing files do not block inherited permissions. The data folder contains sensitive accounts and shared documents. The manager shows service state, the local HTTP health endpoint and LAN IPv4 addresses; health can also respond from a different process using that port. It does not configure TLS or silently change firewall settings. Restrict HTTP use to trusted networks and manually configure a scoped private-network firewall rule if needed.

To change the port or data folder, stop and uninstall the service, then install it with the new settings. Uninstalling the service preserves data and the LocalService folder permission; remove that permission manually if no longer needed. Before uninstalling or upgrading the manager, uninstall the service first; the manager installer blocks removal while a service with its name exists. Back up the entire data folder with the service stopped. Do not run the desktop app's foreground server simultaneously against the same data folder. The service log contains lifecycle messages, not the initial password; the separate initial-password file is restricted to Administrators, SYSTEM and LocalService. An administrator should read it privately and delete it after changing the admin password. The service account needs read access to the installed application and write access to its data folder. Build the separate unsigned installer with `npm run dist:server-manager` on Windows with .NET Framework 4 compiler installed.

The setup uses unencrypted HTTP, so use it only on a trusted network; the standalone server supports TLS as described below. Firewall rules are never changed automatically. If clients cannot connect, check Windows Firewall and network policy for the selected TCP port; changes may require an administrator. The LAN address may change when the network changes.

Accounts can live on one central server PC so every client PC shares the same users.

**Server PC**
1. Install Node.js 18+ and copy the `server` folder (both files, no dependencies) to the PC.
2. Run `node server/server.cjs` (or `npm run server` from the repo). Settings (environment variables): `PMS_PORT` (default 8787), `PMS_HOST` (default 0.0.0.0), `PMS_USERS_FILE` (default `server/data/users.json`), `PMS_ADMIN_PASSWORD` (initial admin password, see below), `PMS_SESSION_HOURS` (default 8), `PMS_TLS_KEY` / `PMS_TLS_CERT` (enable HTTPS).
3. Open the firewall for the port (elevated PowerShell): `New-NetFirewallRule -DisplayName "ThryvoPDF Markup Studio" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Domain,Private`
4. For continuous operation independently of the desktop app, an administrator can configure the standalone server as an automatic-start Windows Service using a service wrapper such as NSSM, with a dedicated data folder, appropriate account permissions, environment settings and separate start/stop controls. This application does not install a service or change firewall rules. Alternatively, configure Task Scheduler ("At startup", run `node C:\pms\server\server.cjs` with the variables set).
5. Back up the users file regularly.

**Client PCs**: install the app; on first launch enter the server address (e.g. `192.168.1.10:8787`), use *Test connection*, then register or sign in. The address is saved per Windows user; use *Change* on the login screen to edit it. "Use local accounts on this PC only" is an explicit offline fallback with a separate, non-shared account store.

**Security**: the server hashes passwords with scrypt and per-user salt, locks an email+IP for 15 minutes after 5 failed logins, rate-limits registrations, and issues expiring session tokens. Over plain HTTP, passwords and tokens cross the LAN unencrypted: on untrusted networks enable TLS (`PMS_TLS_KEY`/`PMS_TLS_CERT`, certificate trusted by client PCs via the Windows certificate store, address `https://host:8787`). Anyone on the LAN can register (open registration), and the server session is not currently required to open files, which are local.

### Default administrator and approval workflow

- On first start the server creates the administrator account (user name `admin`) if no admin exists. The initial password is `PMS_ADMIN_PASSWORD` if set (8+ characters); otherwise a random one is generated, printed once on the server console and saved to `ADMIN-INITIAL-PASSWORD.txt` next to the users file (delete it after first login). There is no fixed default password. The admin **must change the password at first login**.
- Registration is restricted: a new registration (name, email, discipline, password) is created as *pending* and shows "Awaiting admin approval". Pending, rejected and disabled users cannot sign in and get a clear message.
- Administrators manage users from **Option > Users** and change their password from **Option > Password**. User management: approve/reject pending, disable/enable, change role (user/admin), reset password (a temporary password is shown once; the user must change it at next login) and delete. Rules are enforced on the server by role; the last active admin and yourself cannot be disabled, demoted or deleted. Disabling, resetting or deleting a user ends their sessions.
- Existing accounts from an earlier server version become active users. Local-account mode has no roles or approval.

Administrators signed in to the server see a non-modal pending-registration badge that opens user management. It checks the authenticated user list immediately and approximately once per minute, without receiving passwords. The badge updates after the next check when users are approved or rejected; connection errors are displayed and retried. No registration emails are sent.

## Assignment notifications

When an uploader grants a user access to a shared document (at upload or later via **Manage access**), that user gets an in-app alert (Notifications button, bottom-right, refreshed about every 30 seconds) and, if configured, an email. Configure SMTP in **ThryvoPDF Server Manager > Assignment notifications** (or `notify.json` in the server data folder: `{"smtp":{"enabled":true,"host":"","port":587,"secure":false,"user":"","password":"","from":"ThryvoPDF <noreply@example.com>"}}`). Use the manager's test button to verify. The SMTP password is stored in that file, so keep the data folder restricted. Email failures never block uploads; they are logged to the server console.

## Shared documents (multi-user collaboration)

Available in server mode only; local PDFs and local-account mode work exactly as before.

- **Upload / open**: click **Open Shared Documents** on the toolbar, **Shared Documents** beside **Open PDF** on the welcome screen, or use **File > Shared Documents**. The uploader selects approved users for each new upload; without selections only the uploader can access it. Use **Manage access** to change those users later. Only the uploader can change access, and an administrator may delete a document only if granted access. Uploads must be PDFs (150 MB max).
- **Live sync**: markup additions, edits and deletions are sent to the server a fraction of a second after you make them and appear on every other open copy within about a second. Each markup keeps its author and date. A banner under the tabs shows who is working in the document (name and discipline) and turns amber when you are offline or your session expired (unsynced changes stay in the tab and are retried).
- **Conflicts**: the server is authoritative and applies changes one at a time (each bumps the document version). Markups have unique ids, so simultaneous additions never collide. If two people edit the *same* markup at the same moment, the last change to reach the server wins and replaces the other, so ownership of a markup is not locked.
- **Persistence**: shared PDFs and their markups are stored in `docs/` next to the users file (default `server/data/docs`), one `.pdf` and one `.json` per document. **Back up the whole `server/data` folder** (users + docs).

Limitations: documents uploaded before per-document access controls become accessible only to their uploader until the uploader grants access. Revoking access prevents subsequent server requests, but cannot retract copies already downloaded. Deploy the updated server as well as the app to enforce access controls; older servers do not enforce them. Only markups are shared (not scale calibrations, bookmarks or sheet metadata); page reorder/rotate/insert are blocked on shared tabs. Sync uses HTTP long-polling; presence expires after 45 seconds. Plain HTTP exposes documents on the LAN unless TLS is enabled.

## Logo

The icon (`assets/icon.svg` is the editable source) shows a drawing sheet with a dimension line, an architectural floor plan with a door swing, and a red revision cloud: the core workflow of the app (measure, markup, review). The T-junction in the plan walls is a subtle nod to *Thryvo* (Thirdy and Yvonne). Regenerate `icon.png`/`icon.ico` after editing with `npm i --no-save @resvg/resvg-js; node scripts/build-icons.cjs`.

## Theme and authorship

Use **Option > Theme** to switch themes; the choice is remembered and applied to Electron's native UI where supported by the operating system. Rename a local PDF tab with its pencil button or by double-clicking its name, then save with Enter or the check button (Escape cancels); this renames the local PDF file when it has a disk path. Shared-document tab names cannot be renamed. Markup and comment authors are always the signed-in user's name (there is no editable Author field), and in shared documents the server stamps authorship from the login session.

## Uploading to the shared library

In **Shared...** use **Upload PDFs...** (multi-select) or **Upload project folder...** (every PDF in the folder and its subfolders; the folder name becomes the project, subfolder paths are kept and shown in the list). An optional *Project name* overrides the grouping. Uploads run one file at a time with per-file success/error; non-PDFs, files over 150 MB and unauthenticated requests are rejected by the server. **Upload current tab** now reports its result inside the dialog and handles markups of any size. Limits: max 500 PDFs per selection; folders are flat records with a path label (no server-side folder permissions); duplicates are not detected.

> If uploading shows **Not found** / *does not support this feature*, the server PC is running an older server build. Copy the current `server` folder there and restart it (shared documents need the server from this version).

## Annotation IDs and comments in the PDF

Each review markup (except a plain **Line** drawing or **Stamp**) shows a red **numbered tag** (#1, #2, #3... ordered by page, then creation time; renumbers when markups are added or removed) on the drawing, with its comments in a bordered callout when present, and the same tag is drawn into the saved PDF appearance. The number is a display label; the stable internal ID is saved as the standard annotation name (/NM) and shown in the Markups panel. Each review markup is exported as **one** annotation: /Contents holds its text plus its comment thread, /T the author, with a linked /Popup, so viewers list it as a single review item (no separate reply annotations; older reply annotations are removed on save). Plain Line tools are stored as page drawing content instead: they receive no review number, comment section, /NM, or PDF annotation object, but remain editable and synced in the app. Stamps retain their PDF stamp annotation and appearance but have no review number or comment box. Legacy stamp comments are retained in private app metadata but are not displayed or exported as PDF comments. Comments are re-read from the app's own metadata. Not tested in Acrobat or Bluebeam; popup/tag display varies by viewer.


### Comment callouts, editing and permissions

Each comment appears on the drawing as a callout box (author, text, `(edited)` marker) joined by a leader line to the annotation's endpoint (the arrow's **first point**, the last point for other line-like shapes, and for rectangles/ellipses/clouds the border point nearest the box). Drag the box with the Select tool; its position (`callout`) is stored with the markup, synced to collaborators and drawn into the saved PDF annotation's appearance. Authors can edit or delete their own comments in the Markups panel. Rules, enforced by the server for shared documents (not just hidden in the UI): only the author can **edit** a comment (not even an administrator); only the author **or an administrator** can **delete** it; a **markup** can be deleted only by its **author** (an administrator cannot; the markup's comments go with it). Comment authors are stamped from the login session (name + e-mail), never from the client. Forbidden changes are rejected with HTTP 403 and the client restores the server copy. Limitations: ownership of comments created before this version is matched by display name; local (non-shared) files have no server, so the rules are UI-only there; box/leader are drawn in the PDF but other viewers will not let you drag them, and edits made in other viewers are not imported. Not tested in Acrobat or Bluebeam.

### Library groups, descriptions and the Project tab

Shared documents are listed by **group** (the project name) in both the Shared library dialog and the left **Project** tab. Expand or collapse groups to show their PDFs; each view remembers its own collapse choices on this PC. When you upload the current tab, selected PDFs or a project folder, a form asks for a **group** (choose an existing one, create a new one, or none; a folder defaults to its folder name) and a **description** (up to 500 characters, one description for the whole batch, stored per document and shown in the lists). An uploader in a named group or an administrator with access to every document can rename that entire group; an administrator or the uploader of every document can delete it after confirmation, provided they have access to every document. Deploy the updated server as well as the app. Markups record the author's e-mail (`authorEmail`, set by the server) so author-only deletion is enforced server-side (HTTP 403); markups created before this version fall back to a name match. The Project tab refreshes periodically and on demand.

### Shortcuts, comment text size and refresh

**V** selects the Select tool, **H** toggles Pan (hold **Space** for a temporary pan while any tool is active); shortcuts are ignored while typing in a field. Tool buttons show the hint as a tooltip. Select an annotation and use **Comment text size** beneath its comments (7-18, default 9); the preference is remembered per PC and used on screen and when drawing callouts into saved PDFs. There is no Callout drawing tool: comments are always attached to an annotation. **Line** is the first markup tool. The Project tab's shared list refreshes automatically every 5 minutes while that tab is visible and the window is not hidden (Refresh is still available). In the upload form, Group and Description are on separate lines.

After login the app opens its normal workspace without opening the shared library; use **File > Shared Documents** to open it. Markup CSV exports use the visible comment number (blank for drawing-only lines and stamps), PDF filename and local date/time; the separate takeoff CSV is unchanged.

On Windows, use **Alt+F**, **Alt+E**, **Alt+O**, **Alt+V**, or **Alt+H** to open the File, Edit, Option, View, or Help menu. Underlined letters select menu items. File contains Open Shared and Logout; the toolbar also has **Open Shared...** beside Open PDF and a Logout button after account and pending-registration status. Option contains Password, theme selection, tool defaults and Users for administrators. View offers page organization, zoom, fit and panel controls. Select, Pan, page navigation and zoom also appear in the floating viewer controls. **Ctrl+=** zooms in and **Ctrl+-** zooms out when a PDF is open in the viewer (Command replaces Ctrl on macOS). Use the arrows at the viewer edges or **Ctrl+Alt+L** and **Ctrl+Alt+R** to hide or show the left and right panels independently. Help > License shows activation status, license ID and the device request; it never exposes the device's raw identifier or the signing key.

Select a markup and drag the square handle at the lower-right of its comment box to resize it. The box grows if necessary to fit its text. Use **Show comment box on drawing** in the selected markup's comments to hide or restore the callout; its tag, comments and CSV export remain available. Saved PDF comment text and CSV Comments omit author prefixes; the PDF callout draws the author separately beside the comment ID. The viewer and saved appearance share Helvetica-style text layout and per-comment sizes; other PDF viewers and installed fonts can render glyphs slightly differently, and saved appearances currently use a limited single-byte character encoding. Authors remain in the app, PDF metadata and CSV Author column. Size and visibility are saved in the PDF and synced for shared documents; the collaboration server must be updated to validate these fields. The most recently applied markup color, line width and opacity become defaults across markup tools and are saved on this Windows account. The selected default comment text size is also remembered. Select Stamp and use **Option > Tool defaults** to choose or import a stamp.

After placing a review markup, the Add comment popup accepts Enter to add a comment or Shift+Enter for a new line. Cancel leaves the markup in place without a comment. Drawing-only lines and stamps do not open the popup. Use **Ctrl+Z** to undo and **Ctrl+Y** or **Ctrl+Shift+Z** to redo in the workspace; text fields retain their normal text-editing shortcuts.

### Custom stamps

Select **Stamp**, then **Import stamp...** to use a PNG, JPEG, WebP, GIF, BMP or PDF (maximum 20 MB). For a multi-page PDF, choose the page to use. The selected image or PDF page is rasterized to a bounded PNG and embedded in each markup; no original file path is needed after import. Click the drawing to place it; use Select to move, resize and adjust its opacity. PDF stamp pages and animated GIFs become still images; the image may be downsampled to fit shared-markup limits. Original PDF vector content, hyperlinks and animations are not preserved. Other PDF readers can display the resulting stamp appearance, but custom stamp editing in other apps has not been verified.

### Offline device licensing

Without a license, open local PDFs in the **read-only viewer** without signing in. Editing, saving and shared documents require a signed **perpetual license for each device**. Activation and subsequent checks work offline. Open **Activate** or **Help > License**, copy the device request (a SHA-256 fingerprint of the Windows MachineGuid, not the raw identifier) and send it to the software owner, who returns a license file. Click **Import license file**; it is saved in this PC's application data and verified on each start. The company-server account remains separate.

**Owner setup on a trusted machine:** generate an Ed25519 keypair outside the repository. Keep the private key confidential, restrict access using Windows ACLs and maintain a secure backup. A replacement private key cannot issue licenses for installers built with a different public key.

```powershell
node scripts\license-vendor.cjs keygen C:\SecureKeys\thryvo-private.pem C:\SecureKeys\thryvo-public.pem
$env:PMS_LICENSE_PUBLIC_KEY = 'C:\SecureKeys\thryvo-public.pem'
npm run dist
```

Only the selected public key is embedded in the installer; the private key is never embedded or committed. Builds without `PMS_LICENSE_PUBLIC_KEY` cannot validate signed licenses and should not be distributed as production installers. To issue a license after receiving a customer's exact 64-character device request, on the trusted machine run:

On the owner's trusted Windows PC, double-click `scripts\generate-license.bat` or run it from any working directory using its full path. Keep it alongside `license-issuer-prompt.cjs` and `license-vendor.cjs` in the repository's `scripts` folder, with the rest of the repository intact; Node.js 18 or newer must be installed. The wrapper expects the existing private key at `C:\Users\Tito\ThryvoLicenseKeys\thryvo-private.pem` and does not create or replace keys. Paste the exact 64-character lowercase device request, then enter an output filename or press Enter for the displayed default in your Windows user folder. Existing files are never overwritten: choose another name if one exists. The private key remains on the trusted machine; send only the resulting license file to the recipient. The wrapper uses the signing-key path only for its own process.

Alternatively, issue manually:

```powershell
$env:PMS_LICENSE_PRIVATE_KEY = 'C:\SecureKeys\thryvo-private.pem'
node scripts\license-vendor.cjs issue DEVICE_REQUEST C:\SecureKeys\customer-license.json
```

Deliver that file securely to the customer. No production key or license is supplied with this repository. A Windows reinstall, hardware migration or changed MachineGuid may require a new license. MachineGuid can be cloned or changed; this is a practical device binding, not tamper-proof DRM. Someone with control of the app installation can patch local checks, and an offline license cannot be revoked immediately. Revocation or replacement of trust keys requires a future app update or a separately designed online service.
