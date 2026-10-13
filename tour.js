// 3D school hallway (Three.js) controlled by keyboard, on-screen arrows or hand gestures (MediaPipe).
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export const ROOMS = [
  { id: "homework",   label: "Classroom",    sub: "Homework planner", x: -3, z: -8,  color: 0x2f6fa8 },
  { id: "attendance", label: "Main Office",  sub: "Attendance",       x: 3,  z: -8,  color: 0x2e8b57 },
  { id: "notices",    label: "Notice Board", sub: "Announcements",    x: -3, z: -20, color: 0xd98324 },
  { id: "lostfound",  label: "Lost & Found", sub: "AI object scanner", x: 3, z: -20, color: 0x8a4fb3 },
  { id: "passlab",    label: "Computer Lab", sub: "Password lab",     x: -3, z: -32, color: 0xc0392b }
];

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const HAND_LINES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];

const Z_MIN = -45, Z_MAX = 3, X_LIMIT = 2.4;

let cbs = {};
let stage, video, overlay, renderer, scene, camera, clock;
let running = false, raf = 0, near = null;
const player = { x: 0, z: 2, yaw: 0 };
const keys = { up: false, down: false, left: false, right: false };
const gesture = { on: false, fwd: 0, turn: 0 };

/* ---------- building the 3D world ---------- */

function textTexture(lines, w, h, bg, fg) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `700 ${Math.round(h * 0.42)}px sans-serif`;
  g.fillText(lines[0], w / 2, lines[1] ? h * 0.36 : h / 2);
  if (lines[1]) {
    g.font = `500 ${Math.round(h * 0.26)}px sans-serif`;
    g.fillText(lines[1], w / 2, h * 0.74);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#d9dde3"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#c2c9d4"; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 24);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe6ee);
  scene.fog = new THREE.Fog(0xdfe6ee, 8, 38);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(0, 3, 4);
  scene.add(sun);

  const midZ = (Z_MAX + Z_MIN - 1) / 2;
  const length = Z_MAX - Z_MIN + 1;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, length),
    new THREE.MeshStandardMaterial({ map: floorTexture() })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, midZ);
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(6, length),
    new THREE.MeshStandardMaterial({ color: 0xf5f7fa })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 3.2, midZ);
  scene.add(ceiling);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9edf3 });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(length, 3.2), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-3, 1.6, midZ);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(length, 3.2), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(3, 1.6, midZ);
  scene.add(left, right);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), wallMat);
  back.rotation.y = Math.PI;
  back.position.set(0, 1.6, Z_MAX + 0.5);
  scene.add(back);

  const endWall = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 3.2),
    new THREE.MeshStandardMaterial({
      map: textTexture(["SmartSchool Hub", "Turn around to pick a room"], 768, 400, "#1f5a8c", "#ffc933")
    })
  );
  endWall.position.set(0, 1.6, Z_MIN - 0.5);
  scene.add(endWall);

  // lockers along both walls, skipping the door areas
  const spots = [];
  for (let z = 1; z > Z_MIN; z -= 0.8) {
    if (ROOMS.some((r) => Math.abs(r.z - z) < 1.5)) continue;
    spots.push([-2.75, z], [2.75, z]);
  }
  const lockers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 2.1, 0.76),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
    spots.length
  );
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  spots.forEach(([x, z], i) => {
    dummy.position.set(x, 1.05, z);
    dummy.updateMatrix();
    lockers.setMatrixAt(i, dummy.matrix);
    col.set(i % 4 < 2 ? 0x2b5d8c : 0x3a73a8);
    lockers.setColorAt(i, col);
  });
  scene.add(lockers);

  // doors and signs
  ROOMS.forEach((r) => {
    const side = r.x < 0 ? -1 : 1;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.45, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x20242b })
    );
    frame.position.set(side * 2.96, 1.22, r.z);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 2.3, 1.3),
      new THREE.MeshStandardMaterial({ color: r.color })
    );
    door.position.set(side * 2.88, 1.15, r.z);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.62),
      new THREE.MeshBasicMaterial({ map: textTexture([r.label, r.sub], 512, 132, "#14202e", "#ffffff") })
    );
    sign.position.set(side * 2.9, 2.78, r.z);
    sign.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(frame, door, sign);
  });

  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 80);
  clock = new THREE.Clock();
}

/* ---------- game loop ---------- */

function resize() {
  if (!renderer || !stage.clientWidth) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function nearestRoom() {
  let best = null, bestD = 3.3;
  for (const r of ROOMS) {
    const d = Math.hypot(player.x - r.x, player.z - r.z);
    if (d < bestD) { best = r; bestD = d; }
  }
  return best;
}

function tick() {
  if (!running) return;
  raf = requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  const fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0) || gesture.fwd;
  const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0) || gesture.turn;

  player.yaw += turn * 1.8 * dt;
  const step = fwd * 3 * dt;
  player.x -= Math.sin(player.yaw) * step;
  player.z -= Math.cos(player.yaw) * step;
  player.x = Math.max(-X_LIMIT, Math.min(X_LIMIT, player.x));
  player.z = Math.max(Z_MIN, Math.min(Z_MAX, player.z));

  camera.position.set(player.x, 1.6, player.z);
  camera.rotation.set(0, player.yaw, 0);

  const n = nearestRoom();
  if (n !== near) {
    near = n;
    cbs.onNear && cbs.onNear(near);
  }
  renderer.render(scene, camera);
}

/* ---------- public controls ---------- */

export function init(options) {
  cbs = options;
  stage = options.stage;
  video = options.video;
  overlay = options.overlay;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  buildWorld();
  new ResizeObserver(resize).observe(stage);

  const keyMap = {
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right"
  };
  const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
  window.addEventListener("keydown", (e) => {
    if (!running || typing()) return;
    if (keyMap[e.key]) { keys[keyMap[e.key]] = true; e.preventDefault(); }
    if (e.key === "Enter" || e.key === "e" || e.key === "E") enterNearest();
  });
  window.addEventListener("keyup", (e) => {
    if (keyMap[e.key]) keys[keyMap[e.key]] = false;
  });

  if (options.pad) {
    options.pad.querySelectorAll("[data-move]").forEach((btn) => {
      const k = btn.dataset.move;
      const on = (e) => { keys[k] = true; e.preventDefault(); };
      const off = () => { keys[k] = false; };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointerleave", off);
      btn.addEventListener("pointercancel", off);
    });
  }
}

export function resume() {
  if (!renderer || running) return;
  running = true;
  resize();
  clock.getDelta();
  tick();
}

export function pause() {
  running = false;
  cancelAnimationFrame(raf);
  Object.keys(keys).forEach((k) => (keys[k] = false));
  disableGestures();
}

export function enterNearest() {
  if (near && cbs.onEnter) cbs.onEnter(near);
}

/* ---------- hand gestures ---------- */

let landmarker = null, stream = null, gRaf = 0, lastTime = -1;
let votes = [], pinchFrames = 0, lastPinch = 0;

export const gesturesOn = () => gesture.on;

async function loadLandmarker() {
  const { HandLandmarker, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  const make = (delegate) =>
    HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 1
    });
  try { return await make("GPU"); } catch { return await make("CPU"); }
}

export async function enableGestures() {
  if (gesture.on) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" }, audio: false
    });
    video.srcObject = stream;
    await video.play();
    if (!landmarker) {
      cbs.onStatus("Loading the hand-tracking model...");
      landmarker = await loadLandmarker();
    }
  } catch (err) {
    disableGestures();
    throw err;
  }
  gesture.on = true;
  votes = []; pinchFrames = 0;
  cbs.onGesture(true);
  cbs.onStatus("Show one hand to the camera.");
  gestureLoop();
}

export function disableGestures() {
  const was = gesture.on;
  gesture.on = false;
  gesture.fwd = 0; gesture.turn = 0;
  cancelAnimationFrame(gRaf);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (video) video.srcObject = null;
  if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  if (was || cbs.onGesture) {
    cbs.onGesture && cbs.onGesture(false);
    cbs.onStatus && cbs.onStatus("Hand control is off. Use the arrow keys, WASD or the on-screen arrows.");
  }
}

function gestureLoop() {
  if (!gesture.on) return;
  gRaf = requestAnimationFrame(gestureLoop);
  if (video.readyState < 2 || video.currentTime === lastTime) return;
  lastTime = video.currentTime;
  const result = landmarker.detectForVideo(video, performance.now());
  const lm = result.landmarks && result.landmarks[0];
  drawHand(lm);
  handleHand(lm);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function classify(lm) {
  const wrist = lm[0];
  const extended = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.08;
  const index = extended(8, 6), middle = extended(12, 10);
  const ring = extended(16, 14), pinky = extended(20, 18);
  const palm = dist(lm[0], lm[9]);
  if (dist(lm[4], lm[8]) < palm * 0.35 && middle && ring) return "pinch";
  if (index && !middle && !ring && !pinky) return "point";
  if (index && middle && ring && pinky) return "palm";
  if (!index && !middle && !ring && !pinky) return "fist";
  return "other";
}

const STATUS = {
  point: "Pointing: walking forward. Move your hand left or right to steer.",
  palm: "Open palm: stopped.",
  fist: "Fist: walking backward.",
  pinch: "Pinch: entering the door.",
  other: "Gesture not recognized: stopped."
};

function handleHand(lm) {
  gesture.fwd = 0; gesture.turn = 0;
  if (!lm) {
    votes = []; pinchFrames = 0;
    cbs.onStatus("No hand seen. Show one hand to the camera.");
    return;
  }
  votes.push(classify(lm));
  if (votes.length > 5) votes.shift();
  const counts = {};
  votes.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  const stable = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  if (stable === "point") {
    gesture.fwd = 1;
    const off = (1 - lm[8].x) - 0.5; // camera image is mirrored for the user
    if (Math.abs(off) > 0.12) {
      gesture.turn = -Math.sign(off) * Math.min(1, (Math.abs(off) - 0.12) / 0.25);
    }
  } else if (stable === "fist") {
    gesture.fwd = -1;
  }

  if (stable === "pinch") {
    pinchFrames++;
    if (pinchFrames >= 5 && performance.now() - lastPinch > 1500) {
      lastPinch = performance.now();
      pinchFrames = 0;
      if (near) enterNearest();
      else cbs.onStatus("Walk up to a door first, then pinch.");
      return;
    }
  } else {
    pinchFrames = 0;
  }
  cbs.onStatus(STATUS[stable] || STATUS.other);
}

function drawHand(lm) {
  const w = video.videoWidth, h = video.videoHeight;
  if (overlay.width !== w) { overlay.width = w; overlay.height = h; }
  const g = overlay.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!lm) return;
  g.strokeStyle = "#ffc933"; g.lineWidth = 3;
  HAND_LINES.forEach(([a, b]) => {
    g.beginPath();
    g.moveTo(lm[a].x * w, lm[a].y * h);
    g.lineTo(lm[b].x * w, lm[b].y * h);
    g.stroke();
  });
  g.fillStyle = "#ffffff";
  lm.forEach((p) => { g.beginPath(); g.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2); g.fill(); });
}
