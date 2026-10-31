/* Downloads Google's MediaPipe Face Landmarker model (~3.6 MB) into public/models,
 * so drivers' phones load it from your own server. Run once: npm run fetch-model */
const fs = require('fs');
const path = require('path');
const URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const out = path.join(__dirname, '..', 'public', 'models', 'face_landmarker.task');
(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('Saved', out, fs.statSync(out).size, 'bytes');
})().catch(e => { console.error(e.message); process.exit(1); });
