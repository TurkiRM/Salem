/* Salem — eye-gaze detector
 *
 * Uses Google MediaPipe Face Landmarker (478 landmarks incl. iris) in the browser.
 * Nothing leaves the phone except screenshots taken at the moment of a violation.
 *
 * Features per frame:
 *   yaw, pitch  — head rotation (degrees) from the facial transformation matrix
 *   ix, iy      — pupil position inside each eye (0..1), averaged across both eyes
 *   eh, ev      — eye direction from the model's eyeLook* blendshapes
 *
 * Calibration records three looks with the phone in its real mount:
 *   1. looking at the screen, 2. looking at the road, 3. head on the road but eyes on the screen.
 * Each frame is then classified by which look it is closest to. Eye features count
 * twice as much as head features, so an eyes-only glance at the phone is caught.
 *
 * Sunglasses: dark lenses hide the pupils, and the model then guesses eye positions.
 * About once a second the eye area is compared with the cheeks and forehead. When it is
 * dark and shows no white of the eye, the detector switches to HEAD-ONLY mode: eye
 * features are ignored and only head direction decides. It switches back automatically.
 */
import { FaceLandmarker, FilesetResolver } from '/vendor/mediapipe/vision_bundle.mjs';

const WASM_URL = '/vendor/mediapipe/wasm';
const LOCAL_MODEL = '/models/face_landmarker.task';
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function modelUrl() {
  try {
    const r = await fetch('/api/model-source');
    if (r.ok && (await r.json()).local) return LOCAL_MODEL;
  } catch (_) {}
  return REMOTE_MODEL;
}

// Landmark indices (MediaPipe face mesh with refined iris)
const R_EYE = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468, cheek: 205 };
const L_EYE = { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473, cheek: 425 };
const FOREHEAD = 151;

/* Features and how much each one counts.
 * Eyes count twice as much as the head: a driver can keep the head facing the road
 * and still read the phone with the eyes only. */
const FEATURES = ['yaw', 'pitch', 'ix', 'iy', 'eh', 'ev'];
const HEAD = ['yaw', 'pitch'];
const WEIGHT = { yaw: 0.5, pitch: 0.5, ix: 1, iy: 1, eh: 1, ev: 1 };
// Minimum spread per feature so a very still calibration does not make the classifier hypersensitive
const MIN_STD = { yaw: 3, pitch: 3, ix: 0.035, iy: 0.06, eh: 0.05, ev: 0.05 };

const SUN_CHECK_MS = 900;   // how often the eye area is checked for dark lenses
const SUN_WINDOW = 5;       // checks remembered
const SUN_ON = 4;           // switch to head-only when >= 4 of the last 5 checks see dark lenses
const SUN_OFF = 1;          // switch back when <= 1 of the last 5 do

/** Pure function (exported for tests): does the eye area look like dark lenses?
 *  data: RGBA pixels of a w x h image. lm: landmarks in 0..1 image coordinates. */
export function lensCheck(data, w, h, lm) {
  const lum = (x, y) => {
    const i = (Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const patch = (cx, cy, half) => {
    const v = [];
    for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) v.push(lum(x, y));
    return v;
  };
  const median = v => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

  const eyeStats = (E) => {
    const a = lm[E.outer], b = lm[E.inner];
    const x0 = Math.min(a.x, b.x) * w, x1 = Math.max(a.x, b.x) * w;
    const ew = x1 - x0;
    const cy = ((lm[E.top].y + lm[E.bottom].y) / 2) * h;
    const v = [];
    // inner 80% of the eye width, +- 25% of eye width vertically: lens area, without eyebrows
    for (let y = cy - ew * 0.25; y <= cy + ew * 0.25; y++)
      for (let x = x0 + ew * 0.1; x <= x1 - ew * 0.1; x++) v.push(lum(x, y));
    const ch = lm[E.cheek];
    return { v, ew, cheek: median(patch(ch.x * w, ch.y * h, Math.max(1, ew * 0.15))) };
  };

  const r = eyeStats(R_EYE), l = eyeStats(L_EYE);
  if (r.ew < 4 || l.ew < 4) return null; // face too small to judge
  const fh = lm[FOREHEAD];
  const skin = median([r.cheek, l.cheek, median(patch(fh.x * w, fh.y * h, Math.max(1, r.ew * 0.15)))]);
  if (skin < 25) return null; // too dark overall (night) — cannot judge, keep current mode

  const eye = [...r.v, ...l.v];
  const mean = eye.reduce((s, x) => s + x, 0) / eye.length;
  // White of the eye: pixels near or brighter than the skin. Dark lenses leave almost none
  // (a little glare can remain, hence the small threshold).
  const bright = eye.filter(x => x >= skin * 0.85).length / eye.length;
  const ratio = mean / skin;
  const dark = ratio < 0.5 && bright < 0.06;
  return { dark, ratio: Math.round(ratio * 100) / 100, bright: Math.round(bright * 1000) / 1000 };
}

export class GazeDetector {
  constructor() {
    this.landmarker = null;
    this.calib = null;
    this.lastTs = -1;
    this.history = []; // {t, ix, onScreen}
    this.sunglasses = false;
    this.sunVotes = [];
    this.lastSunCheck = 0;
    this.canvas = null;
  }

  async init(onProgress) {
    onProgress && onProgress('wasm');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    onProgress && onProgress('model');
    const MODEL_URL = await modelUrl();
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,          // eyeLookIn/Out/Up/Down: the model's own estimate of where each eye points
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (_) {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    onProgress && onProgress('ready');
  }

  /** Check the eye area for dark lenses about once a second, with hysteresis */
  checkLenses(video, lm, t) {
    if (t - this.lastSunCheck < SUN_CHECK_MS) return;
    this.lastSunCheck = t;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const w = 320, h = Math.round(vh / vw * w);
    if (!this.canvas) this.canvas = document.createElement('canvas');
    const c = this.canvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    let res;
    try { res = lensCheck(ctx.getImageData(0, 0, w, h).data, w, h, lm); } catch (_) { return; }
    if (!res) return;
    this.lastLens = res;
    this.sunVotes.push(res.dark ? 1 : 0);
    if (this.sunVotes.length > SUN_WINDOW) this.sunVotes.shift();
    const n = this.sunVotes.reduce((a, b) => a + b, 0);
    if (!this.sunglasses && n >= SUN_ON) this.sunglasses = true;
    else if (this.sunglasses && n <= SUN_OFF) this.sunglasses = false;
  }

  /** Forget lens history (start of calibration) and decide quickly from the first checks */
  resetLenses() { this.sunVotes = []; this.sunglasses = false; this.lastSunCheck = 0; }

  /** Run one frame. Returns {face:false} or {face:true, f:{yaw,pitch,ix,iy,eh,ev}, sunglasses} */
  read(video, ts) {
    if (!this.landmarker || video.readyState < 2) return { face: false };
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    let res;
    try { res = this.landmarker.detectForVideo(video, ts); } catch (_) { return { face: false }; }
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) return { face: false };
    const lm = res.faceLandmarks[0];
    if (lm.length < 478) return { face: false };

    // Head direction
    let yaw = 0, pitch = 0;
    const mat = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
    if (mat && mat.data) {
      const m = mat.data; // column-major 4x4
      const r20 = m[2], r21 = m[6], r22 = m[10];
      pitch = Math.atan2(r21, r22) * 180 / Math.PI;
      yaw = Math.asin(Math.max(-1, Math.min(1, -r20))) * 180 / Math.PI;
    }

    // Pupil position inside each eye (geometry)
    const eye = (E) => {
      const a = lm[E.outer], b = lm[E.inner], top = lm[E.top], bot = lm[E.bottom], ir = lm[E.iris];
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      const w = maxX - minX, h = bot.y - top.y;
      return {
        ix: w > 1e-4 ? (ir.x - minX) / w : 0.5,
        iy: Math.abs(h) > 1e-4 ? (ir.y - top.y) / h : 0.5,
        open: w > 1e-4 ? Math.abs(h) / w : 0
      };
    };
    const r = eye(R_EYE), l = eye(L_EYE);

    // Eye direction (model estimate). Works even when the eyelids drop while looking down.
    let eh = 0, ev = 0;
    const bs = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;
    if (bs) {
      const g = {};
      for (const c of bs) g[c.categoryName] = c.score;
      const v = k => g[k] || 0;
      eh = ((v('eyeLookOutLeft') - v('eyeLookInLeft')) + (v('eyeLookInRight') - v('eyeLookOutRight'))) / 2;
      ev = (v('eyeLookDownLeft') + v('eyeLookDownRight')) / 2 - (v('eyeLookUpLeft') + v('eyeLookUpRight')) / 2;
    }

    this.checkLenses(video, lm, ts);

    const f = { yaw, pitch, ix: (r.ix + l.ix) / 2, iy: (r.iy + l.iy) / 2, eh, ev };
    return { face: true, f, sunglasses: this.sunglasses, openness: (r.open + l.open) / 2 };
  }

  /** Build the calibration.
   *  screen: looking at the phone naturally
   *  road:   looking ahead at the road
   *  glance: head facing the road, ONLY the eyes on the phone (optional; skipped with sunglasses)
   *  headOnly: true when calibrating with sunglasses — eye features are not trusted
   *  Returns {ok, glanceOk, headOk, separation, glanceSeparation, headSeparation} */
  calibrate(screenSamples, roadSamples, glanceSamples, headOnly = false) {
    const stats = (arr) => {
      const mean = {}, std = {};
      for (const k of FEATURES) {
        const v = arr.map(s => s[k]);
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        mean[k] = m;
        std[k] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
      }
      return { mean, std };
    };
    if (screenSamples.length < 8 || roadSamples.length < 8) return { ok: false, reason: 'few_samples' };
    const groups = [stats(screenSamples), stats(roadSamples)];
    const hasGlance = !headOnly && glanceSamples && glanceSamples.length >= 8;
    if (hasGlance) groups.push(stats(glanceSamples));
    const scale = {};
    for (const k of FEATURES) scale[k] = Math.max(MIN_STD[k], groups.reduce((a, g) => a + g.std[k], 0) / groups.length);
    this.calib = { road: groups[1].mean, scale, clusters: [], head: null, eyesTrusted: !headOnly };

    // Head-only signature, used whenever sunglasses are on
    const headSep = this.distHead(groups[0].mean, groups[1].mean);
    const headOk = headSep >= 2;
    if (headOk) this.calib.head = { screen: groups[0].mean, sep: headSep };

    // Full (eyes + head) signatures
    const sep = headOnly ? headSep : this.dist(groups[0].mean, groups[1].mean);
    const ok = headOnly ? headOk : sep >= 2.5; // below this the looks are almost identical from the camera's view
    if (ok && !headOnly) this.calib.clusters.push({ mean: groups[0].mean, sep });
    let glanceSep = null, glanceOk = false;
    if (hasGlance) {
      glanceSep = this.dist(groups[2].mean, groups[1].mean);
      glanceOk = glanceSep >= 2;
      if (glanceOk) this.calib.clusters.push({ mean: groups[2].mean, sep: glanceSep });
    }
    if (!ok) this.calib = null;
    const round = x => x == null ? null : Math.round(x * 10) / 10;
    return {
      ok, glanceOk, headOk, headOnly,
      separation: round(sep), glanceSeparation: round(glanceSep), headSeparation: round(headSep),
      reason: ok ? null : 'too_close'
    };
  }

  /** Weighted, spread-normalised distance between two feature sets */
  dist(f, ref) {
    let d = 0;
    for (const k of FEATURES) d += WEIGHT[k] * ((f[k] - ref[k]) / this.calib.scale[k]) ** 2;
    return Math.sqrt(d);
  }

  /** Same, head direction only */
  distHead(f, ref) {
    let d = 0;
    for (const k of HEAD) d += ((f[k] - ref[k]) / this.calib.scale[k]) ** 2;
    return Math.sqrt(d);
  }

  /** Which detection is in use right now: 'eyes' (full), 'head' (sunglasses), 'none' (sunglasses but
   *  head direction can't tell screen from road for this phone position) */
  mode() {
    if (!this.calib) return 'none';
    const headOnly = this.sunglasses || !this.calib.eyesTrusted;
    if (!headOnly) return 'eyes';
    return this.calib.head ? 'head' : 'none';
  }

  /** true when the driver is looking at the phone screen */
  isOnScreen(f) {
    if (!this.calib) {
      // Fallback: facing the camera with pupils centred
      return Math.abs(f.yaw) < 14 && Math.abs(f.pitch) < 14 && f.ix > 0.33 && f.ix < 0.67;
    }
    const m = this.mode();
    if (m === 'none') return false;
    if (m === 'head') {
      // Sunglasses: the head must turn toward the phone
      const h = this.calib.head;
      const ds = this.distHead(f, h.screen), dr = this.distHead(f, this.calib.road);
      return ds < dr * 0.85 && ds < Math.max(2.5, h.sep * 0.9);
    }
    const dr = this.dist(f, this.calib.road);
    for (const c of this.calib.clusters) {
      const ds = this.dist(f, c.mean);
      // Closer to this "screen" signature than to the road, and not wildly far from it
      if (ds < dr * 0.85 && ds < Math.max(3, c.sep * 0.9)) return true;
    }
    return false;
  }

  /** Track pupil x for reading-pattern detection (not recorded while sunglasses hide the eyes) */
  push(t, f, onScreen) {
    this.history.push({ t, ix: f && this.mode() === 'eyes' ? f.ix : null, onScreen });
    while (this.history.length && t - this.history[0].t > 6000) this.history.shift();
  }

  /** Count horizontal saccades (direction reversals of the pupil) in the last `windowMs` while on screen.
   *  Reading text and typing produce a left-right sweep pattern; a map glance does not. */
  readingPattern(now, windowMs = 3000) {
    const pts = this.history.filter(h => h.onScreen && h.ix != null && now - h.t <= windowMs).map(h => h.ix);
    if (pts.length < 6) return { reading: false, saccades: 0 };
    // light smoothing
    const sm = pts.map((v, i) => (pts[i - 1] ?? v) * 0.25 + v * 0.5 + (pts[i + 1] ?? v) * 0.25);
    let dir = 0, last = sm[0], saccades = 0;
    const AMP = 0.03;
    for (let i = 1; i < sm.length; i++) {
      const d = sm[i] - last;
      if (Math.abs(d) < AMP) continue;
      const nd = Math.sign(d);
      if (dir && nd !== dir) saccades++;
      dir = nd; last = sm[i];
    }
    return { reading: saccades >= 3, saccades };
  }
}
