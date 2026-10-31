/* Salem — eye-gaze detector
 *
 * Uses Google MediaPipe Face Landmarker (478 landmarks incl. iris) in the browser.
 * Nothing leaves the phone except screenshots taken at the moment of a violation.
 *
 * Features per frame:
 *   yaw, pitch  — head rotation (degrees) from the facial transformation matrix
 *   ix, iy      — pupil position inside each eye (0..1), averaged across both eyes
 *
 * A short calibration records the driver's "looking at screen" and "looking at road"
 * signatures with the phone in its real mount position. Each frame is then classified
 * by which signature it is closer to (distance scaled by the spread seen in calibration).
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
const R_EYE = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const L_EYE = { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 };
const FEATURES = ['yaw', 'pitch', 'ix', 'iy'];
// Minimum spread per feature so a very still calibration does not make the classifier hypersensitive
const MIN_STD = { yaw: 3, pitch: 3, ix: 0.035, iy: 0.06 };

export class GazeDetector {
  constructor() {
    this.landmarker = null;
    this.calib = null;
    this.lastTs = -1;
    this.history = []; // {t, ix, onScreen}
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
      outputFaceBlendshapes: false,
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

  /** Run one frame. Returns {face:false} or {face:true, f:{yaw,pitch,ix,iy}} */
  read(video, ts) {
    if (!this.landmarker || video.readyState < 2) return { face: false };
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    let res;
    try { res = this.landmarker.detectForVideo(video, ts); } catch (_) { return { face: false }; }
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) return { face: false };
    const lm = res.faceLandmarks[0];
    if (lm.length < 478) return { face: false };

    let yaw = 0, pitch = 0;
    const mat = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
    if (mat && mat.data) {
      const m = mat.data; // column-major 4x4
      const r20 = m[2], r21 = m[6], r22 = m[10];
      pitch = Math.atan2(r21, r22) * 180 / Math.PI;
      yaw = Math.asin(Math.max(-1, Math.min(1, -r20))) * 180 / Math.PI;
    }
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
    const f = { yaw, pitch, ix: (r.ix + l.ix) / 2, iy: (r.iy + l.iy) / 2 };
    const openness = (r.open + l.open) / 2; // eyes closed / looking far down -> small
    return { face: true, f, openness };
  }

  /** Build a calibration from two arrays of feature samples. Returns {ok, separation} */
  calibrate(screenSamples, roadSamples) {
    const stats = (arr) => {
      const mean = {}, std = {};
      for (const k of FEATURES) {
        const v = arr.map(s => s[k]);
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
        mean[k] = m; std[k] = sd;
      }
      return { mean, std };
    };
    if (screenSamples.length < 8 || roadSamples.length < 8) return { ok: false, reason: 'few_samples' };
    const s = stats(screenSamples), r = stats(roadSamples);
    const scale = {};
    for (const k of FEATURES) scale[k] = Math.max(MIN_STD[k], (s.std[k] + r.std[k]) / 2);
    let sep = 0;
    for (const k of FEATURES) sep += ((s.mean[k] - r.mean[k]) / scale[k]) ** 2;
    sep = Math.sqrt(sep);
    this.calib = { screen: s.mean, road: r.mean, scale, sep };
    // Separation below ~2.5 means the two looks are almost identical from the camera's view
    return { ok: sep >= 2.5, separation: Math.round(sep * 10) / 10, reason: sep >= 2.5 ? null : 'too_close' };
  }

  dist(f, ref) {
    let d = 0;
    for (const k of FEATURES) d += ((f[k] - ref[k]) / this.calib.scale[k]) ** 2;
    return Math.sqrt(d);
  }

  /** true when the driver is looking at the phone screen */
  isOnScreen(f) {
    if (!this.calib) {
      // Fallback: facing the camera with pupils centred
      return Math.abs(f.yaw) < 14 && Math.abs(f.pitch) < 14 && f.ix > 0.33 && f.ix < 0.67;
    }
    const ds = this.dist(f, this.calib.screen), dr = this.dist(f, this.calib.road);
    // Closer to the "screen" signature, and not wildly far from it
    return ds < dr * 0.85 && ds < Math.max(3, this.calib.sep * 0.9);
  }

  /** Track pupil x for reading-pattern detection */
  push(t, f, onScreen) {
    this.history.push({ t, ix: f ? f.ix : null, onScreen });
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
