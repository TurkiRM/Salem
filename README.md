# سالم | Salem

منصة ويب لمنع استخدام الجوال أثناء القيادة. يرسل المشرف طلب مراقبة للسائق لمدة محددة (30 دقيقة إلى 4 ساعات أو أي مدة)، فيفتح السائق صفحة سالم على جواله ويوافق، وتتابع الكاميرا الأمامية اتجاه عينيه. إذا نظر إلى الشاشة 3 ثوانٍ متواصلة والسيارة تتحرك، تُلتقط صورة وتُرسل للمشرف مع السرعة والموقع.

A web platform that stops drivers from using their phone while driving. A supervisor sends a monitoring request for a set time; the driver opens Salem on their phone and accepts; the front camera tracks the driver's eyes. If the driver looks at the screen for 3 continuous seconds while moving, a photo is sent to the supervisor with speed and location.

---

## Three areas

| Address | Who | What they do |
|---|---|---|
| `/` → `/admin` | You (platform owner) | Create companies and their supervisor accounts, enable or disable a company |
| `/` → `/panel` | Company supervisors | Add drivers, send monitoring requests, watch live sessions, review violations with photos, scores, settings |
| `/driver` | Drivers (on their phone) | Sign in with company code + phone + PIN, accept or decline requests, run the monitored session |

Each company sees only its own drivers and violations.

## What gets recorded

| Event | When |
|---|---|
| **Looked at screen** | Eyes on the screen for at least `gaze_seconds` (default 3 s) while speed is at or above `min_speed_kmh` (default 10 km/h). Photo, speed, GPS. If the pupils sweep left-right (reading or typing) it is tagged **Reading/typing pattern**. |
| **Left Salem** | The driver switched to another app (WhatsApp, YouTube…) for 3 s or more while moving. Logged with how long they were away. The panel shows "Left the app" live. |
| **Face not visible** | No face in the camera for `face_lost_seconds` (default 8 s, set by the supervisor) while moving (camera covered, or phone turned away). |
| **Ended monitoring early** | The driver stopped the session before the time was up. |
| **Connection lost** (live status) | No signal from the phone for 45 s, for example because the browser was closed. |

Supervisors confirm or dismiss each violation. Dismissed ones don't count toward the driver's score (100 = clean, last 30 days).

## How eye detection works

- Google **MediaPipe Face Landmarker** runs inside the phone's browser. It finds 478 face points, including both pupils, and the head angle.
- **Calibration** (9 seconds, at the start of every session), with the phone in its real mount:
  1. look at the screen normally (3 s)
  2. look at the road (3 s)
  3. keep the head facing the road and move **only the eyes** to the screen (3 s), the way someone sneaks a look at their phone
  If steps 1 and 2 look too similar (phone straight in front of the eyes), Salem asks the driver to move the phone and try again. If only step 3 can't be told apart, the driver can retry or continue without it.
- Eye direction counts twice as much as head direction, so a driver who keeps the head on the road but reads with the eyes is still caught. Salem combines the pupil position inside each eye with the model's own eye-direction estimate.
- **Sunglasses.** Dark lenses hide the pupils, and the eye model then only guesses. About once a second Salem compares the eye area with the cheeks and forehead. When it's dark and shows no white of the eye, Salem switches to **head-direction mode**: eye readings are ignored, and a violation needs the head to turn toward the phone for the set seconds. It switches back automatically when the sunglasses come off.
  - Calibration with sunglasses on uses steps 1 and 2 only. If the phone sits straight in front of the eyes, head direction can't tell screen from road, so the driver is asked to move it lower or to the side.
  - Eyes-only looks can't be detected with dark sunglasses. That's a limit of any normal phone camera.
  - The supervisor sees "Sunglasses — head direction only" on the live card, a "Sunglasses · head direction" tag on each such violation, and the minutes monitored this way in Request history.
- After that, every frame (about 15 per second) is classified as screen or road. A blink doesn't reset the 3-second timer.
- Video never leaves the phone. Only the violation photo is uploaded.
- While the car is stopped (below the minimum speed), nothing is recorded.

---

## Run it

Requirements: **Node.js 22.13 or newer** (Node 24 recommended). The database is Node's built-in SQLite, so nothing needs compiling on Windows, Mac or Linux.

```bash
npm install
cp .env.example .env        # then edit .env: set JWT_SECRET and the admin password
npm run fetch-model         # optional: serve the eye model from your own server (3.6 MB)
npm start
```

Open `http://localhost:3000` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

### Go live (HTTPS is required)

Phones only allow the camera on **https** pages. Any of these works:

- **Render / Railway**: create a Node web service from this folder, start command `npm start`, add the `.env` values as environment variables, set `COOKIE_SECURE=true`, and add a **persistent disk** mounted at `DATA_DIR` (the database and photos live there).
- **Your own VPS**: run with `pm2 start server.js --name salem`, put Nginx in front with a Let's Encrypt certificate, and set `COOKIE_SECURE=true`.

### First steps after deploying

1. Sign in as admin → **Add company** (company name + first supervisor email and password). You get a 6-letter **company code**.
2. Sign in as that supervisor → **Drivers → Add driver**. A 6-digit PIN appears once. Tap **Copy message** and send it to the driver on WhatsApp.
3. **Request monitoring** → pick the driver and the duration. For a desk test, tick **Test mode** so it detects without the car moving.
4. On the phone: open `/driver`, sign in, **Accept** → consent → calibrate → monitoring starts.
5. Look at the phone for 3 seconds. The violation appears in the panel within about 5 seconds, with the photo.

Tip for drivers: from the browser menu choose **Add to Home screen**, so Salem opens like an app.

---

## Settings (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Server port |
| `JWT_SECRET` | — | Long random string that signs sign-in cookies. **Change it.** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | — | Platform owner account, created on first start |
| `DATA_DIR` | `./data` | SQLite database and photos |
| `SNAPSHOT_RETENTION_DAYS` | 30 | Photos older than this are deleted automatically (0 = keep) |
| `REQUEST_EXPIRY_MIN` | 15 | Minutes a driver has to accept before the request expires |
| `COOKIE_SECURE` | false | Set to `true` behind HTTPS |

Per-company settings (in the panel under **Settings**): seconds looking at the screen before recording, the minimum speed that counts as moving, and seconds the face can be hidden before recording.

## Limits to know

- **The page must stay open.** A web page can't watch while another app is in front. That's why switching apps while moving is logged as **Left Salem**. It also means drivers can't use Google Maps on the same phone during monitoring without it being logged. Next steps that solve this: a built-in navigation map inside Salem, or a native Android app.
- **iPhone (Safari)**: works while Salem is open. iOS may stop the camera when the screen locks; Salem keeps the screen on while it's open.
- **Speed** comes from the phone's GPS. Indoors or in tunnels it can be 0 or jumpy.
- **Lighting**: at night the front camera needs some cabin light to see the eyes. In complete darkness, the driver gets **Face not visible** events.
- **Privacy (PDPL)**: drivers see a clear consent screen for every session, and photos are kept only for `SNAPSHOT_RETENTION_DAYS`. Add your own privacy policy and terms before going live with real companies.

## Files

```
server.js                 API, auth, database (SQLite), photo storage
scripts/fetch-model.js    downloads the MediaPipe face model to public/models
public/index.html         sign-in for admin and supervisors
public/admin.html         platform admin (companies)
public/panel.html         supervisor panel  (+ js/panel.js)
public/driver.html        driver phone screen (+ js/driver.js, css/driver.css)
public/js/gaze.js         eye-gaze detector (MediaPipe + calibration + reading pattern)
public/js/i18n.js         Arabic / English text
public/js/common.js       shared helpers and icons
public/css/style.css      shared styles (light/dark)
```
