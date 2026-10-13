// Webcam object detector (TensorFlow.js COCO-SSD) used by the Lost & Found scanner.
const TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js";
const COCO = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";

let model = null, stream = null, timer = 0, running = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

export const isRunning = () => running;

export async function start({ video, canvas, onStatus, onDetect }) {
  if (running) return;
  onStatus("Starting the camera...");
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 }, audio: false
  });
  video.srcObject = stream;
  await video.play();

  try {
    if (!model) {
      onStatus("Loading the AI model (the first time takes a few seconds)...");
      await loadScript(TFJS);
      await loadScript(COCO);
      model = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
    }
  } catch (err) {
    stop(video, canvas);
    throw err;
  }

  running = true;
  onStatus("Scanning. Hold an item in front of the camera.");

  const loop = async () => {
    if (!running) return;
    try {
      const preds = await model.detect(video);
      draw(canvas, video, preds);
      onDetect(preds.filter((p) => p.score > 0.5));
    } catch (err) {
      console.warn(err);
    }
    timer = setTimeout(loop, 150);
  };
  loop();
}

export function stop(video, canvas) {
  running = false;
  clearTimeout(timer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (video) video.srcObject = null;
  if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function draw(canvas, video, preds) {
  const w = video.videoWidth, h = video.videoHeight;
  if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  g.lineWidth = 3;
  g.font = "600 18px sans-serif";
  preds.filter((p) => p.score > 0.5).forEach((p) => {
    const [x, y, bw, bh] = p.bbox;
    g.strokeStyle = "#ffc933";
    g.strokeRect(x, y, bw, bh);
    const text = `${p.class} ${Math.round(p.score * 100)}%`;
    const tw = g.measureText(text).width + 10;
    g.fillStyle = "#14202e";
    g.fillRect(x, Math.max(0, y - 24), tw, 24);
    g.fillStyle = "#ffffff";
    g.fillText(text, x + 5, Math.max(18, y - 6));
  });
}

// Returns a small JPEG (data URL) of the whole frame or of one detected box.
export function snapshot(video, bbox) {
  const vw = video.videoWidth, vh = video.videoHeight;
  let [x, y, w, h] = bbox || [0, 0, vw, vh];
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(w, vw - x); h = Math.min(h, vh - y);
  const scale = Math.min(1, 200 / w);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d").drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.6);
}
