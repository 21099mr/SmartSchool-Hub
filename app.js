import {
  configured, auth, db, isAdminEmail,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from "./firebase.js";
import { logActivity } from "./logger.js";
import { checkPassword, renderMeter } from "./passwordCheck.js";

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = (ts) => (ts && ts.toDate ? ts.toDate() : null);
const fmt = (ts) => {
  const d = toDate(ts);
  return d ? d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "just now";
};
const fmtDay = (ts) => {
  const d = toDate(ts);
  return d ? d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "-";
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

const state = {
  user: null,
  isAdmin: false,
  view: null,
  subs: [],
  attSub: null,
  cache: { users: [], activity: [], notices: [], lost: [], homework: [], attendance: [], attToday: [], attSel: [] },
  filter: { q: "", action: "", uid: "" }
};

const USER_NAV = [
  ["tour", "3D tour"], ["homework", "Homework"], ["attendance", "Attendance"],
  ["notices", "Notices"], ["lostfound", "Lost & found"], ["passlab", "Password lab"]
];
const ADMIN_NAV = [
  ["a-dashboard", "Dashboard"], ["a-activity", "Activity history"], ["a-users", "Users"],
  ["a-attendance", "Attendance"], ["a-notices", "Announcements"], ["a-lostfound", "Lost & found"]
];
const VIEW_NAMES = Object.fromEntries([...USER_NAV, ...ADMIN_NAV]);

/* ---------- start-up ---------- */
if (!configured) {
  $("#setup").classList.remove("hidden");
} else {
  wireAuth();
  wireApp();
  onAuthStateChanged(auth, (user) => (user ? enterApp(user) : leaveApp()));
}

/* ---------- login and sign up ---------- */
function authError(msg) { $("#auth-error").textContent = msg || ""; }

function friendly(err) {
  const map = {
    "auth/email-already-in-use": "That email already has an account. Try signing in.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-login-credentials": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/invalid-email": "That email address does not look right.",
    "auth/weak-password": "Firebase says this password is too weak. Make it longer.",
    "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
    "auth/network-request-failed": "No internet connection.",
    "auth/operation-not-allowed": "Email/Password sign-in is not turned on in Firebase yet (see README step 2)."
  };
  return map[err.code] || `Something went wrong: ${err.code || err.message}`;
}

function wireAuth() {
  const showTab = (name) => {
    const login = name === "login";
    $("#form-login").classList.toggle("hidden", !login);
    $("#form-register").classList.toggle("hidden", login);
    $("#tab-login").classList.toggle("active", login);
    $("#tab-register").classList.toggle("active", !login);
    $("#tab-login").setAttribute("aria-selected", login);
    $("#tab-register").setAttribute("aria-selected", !login);
    authError("");
  };
  $("#tab-login").onclick = () => showTab("login");
  $("#tab-register").onclick = () => showTab("register");

  const regPw = $("#reg-pw");
  const updateRegMeter = () => {
    const name = $("#reg-name").value, email = $("#reg-email").value;
    renderMeter($("#reg-meter"), checkPassword(regPw.value, [name.split(" ")[0], email.split("@")[0]]));
  };
  regPw.addEventListener("input", updateRegMeter);
  $("#reg-name").addEventListener("input", updateRegMeter);
  $("#reg-email").addEventListener("input", updateRegMeter);
  updateRegMeter();
  $("#reg-toggle").onclick = () => {
    const hidden = regPw.type === "password";
    regPw.type = hidden ? "text" : "password";
    $("#reg-toggle").textContent = hidden ? "Hide" : "Show";
  };

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    authError("");
    const btn = e.submitter; btn.disabled = true;
    try {
      const cred = await signInWithEmailAndPassword(auth, $("#login-email").value.trim(), $("#login-pw").value);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: cred.user.displayName || "", email: cred.user.email, lastLogin: serverTimestamp()
      }, { merge: true });
      await logActivity("login", "Signed in");
    } catch (err) {
      authError(friendly(err));
    } finally { btn.disabled = false; }
  });

  $("#form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    authError("");
    const name = $("#reg-name").value.trim();
    const email = $("#reg-email").value.trim();
    const pw = regPw.value;
    const result = checkPassword(pw, [name.split(" ")[0], email.split("@")[0]]);
    if (result.score < 3) {
      authError("Choose a stronger password. The meter must say Strong or Excellent.");
      return;
    }
    const btn = e.submitter; btn.disabled = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name, email: email.toLowerCase(), createdAt: serverTimestamp(), lastLogin: serverTimestamp()
      });
      await logActivity("register", "Created an account");
      renderHeader();
    } catch (err) {
      authError(friendly(err));
    } finally { btn.disabled = false; }
  });
}

/* ---------- entering and leaving the app ---------- */
function renderHeader() {
  const u = auth.currentUser;
  if (!u) return;
  $("#who-name").textContent = u.displayName || u.email;
  $("#who-role").textContent = state.isAdmin ? "Admin" : "Student";
  $("#who-role").classList.toggle("admin", state.isAdmin);
}

function buildNav() {
  const items = state.isAdmin ? ADMIN_NAV : USER_NAV;
  $("#nav").innerHTML = items
    .map(([id, label]) => `<button data-view="${id}">${esc(label)}</button>`).join("");
}

function enterApp(user) {
  state.user = user;
  state.isAdmin = isAdminEmail(user.email);
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  document.body.classList.toggle("is-admin", state.isAdmin);
  renderHeader();
  buildNav();
  startListeners();
  show(state.isAdmin ? "a-dashboard" : "tour");
}

function leaveApp() {
  stopListeners();
  if (tourMod) tourMod.pause();
  stopScanner();
  state.user = null;
  state.view = null;
  $("#app").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
  $("#login-pw").value = "";
  $("#reg-pw").value = "";
}

/* ---------- live data from Firebase ---------- */
function listen(q, onData) {
  state.subs.push(onSnapshot(q, onData, (err) => {
    console.error(err);
    toast("Could not load data. Check the Firestore rules and ADMIN_EMAIL (see README).");
  }));
}
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

function startListeners() {
  const uid = state.user.uid;
  listen(query(collection(db, "announcements"), orderBy("ts", "desc"), limit(50)), (s) => {
    state.cache.notices = rows(s); refresh();
  });
  listen(query(collection(db, "lostfound"), orderBy("ts", "desc"), limit(100)), (s) => {
    state.cache.lost = rows(s); refresh();
  });

  if (state.isAdmin) {
    listen(collection(db, "users"), (s) => { state.cache.users = rows(s); refresh(); });
    listen(query(collection(db, "activity"), orderBy("ts", "desc"), limit(500)), (s) => {
      state.cache.activity = rows(s); refresh();
    });
    listen(query(collection(db, "attendance"), where("date", "==", todayStr())), (s) => {
      state.cache.attToday = rows(s); refresh();
    });
    $("#aa-date").value = todayStr();
    subAttendance(todayStr());
  } else {
    listen(query(collection(db, "homework"), where("uid", "==", uid)), (s) => {
      state.cache.homework = rows(s); refresh();
    });
    listen(query(collection(db, "attendance"), where("uid", "==", uid)), (s) => {
      state.cache.attendance = rows(s); refresh();
    });
  }
}

function subAttendance(date) {
  if (state.attSub) state.attSub();
  state.attSub = onSnapshot(
    query(collection(db, "attendance"), where("date", "==", date)),
    (s) => { state.cache.attSel = rows(s); refresh(); },
    (err) => console.error(err)
  );
}

function stopListeners() {
  state.subs.forEach((u) => u());
  state.subs = [];
  if (state.attSub) { state.attSub(); state.attSub = null; }
  state.cache = { users: [], activity: [], notices: [], lost: [], homework: [], attendance: [], attToday: [], attSel: [] };
}

/* ---------- navigation ---------- */
let tourMod = null;

async function show(name) {
  const prev = state.view;
  if (prev === "tour" && name !== "tour" && tourMod) tourMod.pause();
  if (prev === "lostfound" && name !== "lostfound") stopScanner();
  state.view = name;

  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${name}`));
  $$("#nav button").forEach((b) =>
    b.setAttribute("aria-current", b.dataset.view === name ? "page" : "false"));
  window.scrollTo(0, 0);
  refresh();

  if (prev !== name) {
    if (!state.isAdmin) logActivity("view", VIEW_NAMES[name] || name);
  }
  if (name === "tour") startTour();
}

function refresh() {
  switch (state.view) {
    case "homework": renderHomework(); break;
    case "attendance": renderAttendance(); break;
    case "notices": renderNotices("#notice-list", false); break;
    case "lostfound": renderLost("#lost-list"); break;
    case "a-dashboard": renderDashboard(); break;
    case "a-activity": renderActivity(); break;
    case "a-users": renderUsers(); break;
    case "a-attendance": renderAdminAttendance(); break;
    case "a-notices": renderNotices("#a-notice-list", true); break;
    case "a-lostfound": renderLost("#a-lost-list"); break;
  }
}

/* ---------- wiring for buttons and forms inside the app ---------- */
function wireApp() {
  $("#nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) show(b.dataset.view);
  });

  $("#logout").onclick = async () => {
    await logActivity("logout", "Signed out");
    await signOut(auth);
  };

  wireHomework();
  wireAttendance();
  wireLostFound();
  wireTourButtons();
  wirePasswordLab();
  wireAdmin();
}

/* ---------- 3D tour ---------- */
function wireTourButtons() {
  $("#gesture-toggle").onclick = async () => {
    if (!tourMod) return;
    if (tourMod.gesturesOn()) {
      tourMod.disableGestures();
      logActivity("gesture_off", "Hand control off");
      return;
    }
    try {
      await tourMod.enableGestures();
      logActivity("gesture_on", "Hand control on");
    } catch (err) {
      $("#gesture-status").textContent = cameraError(err);
    }
  };
  $("#tour-enter").onclick = () => tourMod && tourMod.enterNearest();
}

function cameraError(err) {
  if (err && err.name === "NotAllowedError") return "Camera permission was blocked. Click the camera icon in the address bar and allow it.";
  if (err && err.name === "NotFoundError") return "No camera was found on this device.";
  return `Could not start: ${err && err.message ? err.message : err}`;
}

async function startTour() {
  if (!tourMod) {
    try {
      tourMod = await import("./tour.js");
      tourMod.init({
        stage: $("#tour-stage"),
        video: $("#gesture-video"),
        overlay: $("#gesture-canvas"),
        pad: $("#dpad"),
        onNear: (room) => {
          $("#tour-room").textContent = room ? `${room.label}: ${room.sub}` : "Walk toward a door";
          $("#tour-enter").classList.toggle("hidden", !room);
        },
        onEnter: (room) => {
          logActivity("room_enter", room.label);
          show(room.id);
        },
        onStatus: (t) => { $("#gesture-status").textContent = t; },
        onGesture: (on) => {
          $("#gesture-toggle").textContent = on ? "Turn off hand control" : "Turn on hand control";
          $(".cam").classList.toggle("live", on);
        }
      });
    } catch (err) {
      console.error(err);
      $("#tour-stage").innerHTML = '<p class="error pad">The 3D engine could not load. Check your internet connection and reload.</p>';
      tourMod = null;
      return;
    }
  }
  if (state.view === "tour") tourMod.resume();
}

/* ---------- homework ---------- */
function wireHomework() {
  $("#hw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const subject = $("#hw-subject").value.trim();
    const task = $("#hw-task").value.trim();
    const due = $("#hw-due").value;
    try {
      await addDoc(collection(db, "homework"), {
        uid: state.user.uid, subject, task, due, done: false, ts: serverTimestamp()
      });
      logActivity("homework_add", `${subject}: ${task}`);
      e.target.reset();
      $("#hw-subject").focus();
    } catch (err) { toast("Could not save homework."); }
  });

  $("#hw-list").addEventListener("click", async (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const item = state.cache.homework.find((h) => h.id === li.dataset.id);
    if (!item) return;
    try {
      if (e.target.matches("input[type=checkbox]")) {
        await updateDoc(doc(db, "homework", item.id), { done: e.target.checked });
        logActivity(e.target.checked ? "homework_done" : "homework_undone", `${item.subject}: ${item.task}`);
      } else if (e.target.closest("button.del")) {
        await deleteDoc(doc(db, "homework", item.id));
        logActivity("homework_delete", `${item.subject}: ${item.task}`);
      }
    } catch (err) { toast("Could not update homework."); }
  });
}

function renderHomework() {
  const t = todayStr();
  const items = [...state.cache.homework].sort((a, b) =>
    (a.done - b.done) || (a.due || "").localeCompare(b.due || ""));
  $("#hw-list").innerHTML = items.length
    ? items.map((h) => `
      <li data-id="${h.id}" class="${h.done ? "done" : ""}">
        <input type="checkbox" ${h.done ? "checked" : ""} aria-label="Mark done">
        <div class="grow"><b>${esc(h.subject)}</b><span>${esc(h.task)}</span></div>
        <span class="due ${!h.done && h.due < t ? "late" : ""}">${!h.done && h.due < t ? "Overdue " : "Due "}${esc(h.due)}</span>
        <button class="del link" aria-label="Delete">Delete</button>
      </li>`).join("")
    : '<li class="empty">No homework yet. Add your first task above.</li>';
}

/* ---------- attendance (student) ---------- */
function wireAttendance() {
  $("#att-btn").onclick = async () => {
    const t = todayStr();
    const u = state.user;
    try {
      await setDoc(doc(db, "attendance", `${u.uid}_${t}`), {
        uid: u.uid, name: u.displayName || "", email: u.email,
        date: t, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        status: "present", ts: serverTimestamp()
      });
      logActivity("attendance", `Marked present for ${t}`);
      toast("You are marked present.");
    } catch (err) { toast("Could not mark attendance."); }
  };
}

function renderAttendance() {
  const t = todayStr();
  const mine = state.cache.attendance;
  const today = mine.find((a) => a.date === t);
  $("#att-status").textContent = today
    ? `You were marked present today at ${today.time}.`
    : "You have not been marked present today.";
  $("#att-btn").disabled = !!today;
  const sorted = [...mine].sort((a, b) => b.date.localeCompare(a.date));
  $("#att-list").innerHTML = sorted.length
    ? sorted.map((a) => `<li><div class="grow"><b>${esc(a.date)}</b></div><span>Present at ${esc(a.time)}</span></li>`).join("")
    : '<li class="empty">No attendance recorded yet.</li>';
}

/* ---------- notices (shared by both portals) ---------- */
function renderNotices(sel, admin) {
  const list = state.cache.notices;
  $(sel).innerHTML = list.length
    ? list.map((n) => `
      <li data-id="${n.id}">
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.body)}</p>
        <small>${esc(n.author || "Admin")} on ${fmt(n.ts)}</small>
        ${admin ? '<button class="del link">Delete</button>' : ""}
      </li>`).join("")
    : '<li class="empty">No announcements yet.</li>';
}

/* ---------- lost and found (shared board + scanner) ---------- */
let detMod = null;
let pendingThumb = "";
let lastPreds = [];
let chipKey = "";

function wireLostFound() {
  $("#lf-start").onclick = async () => {
    if (detMod && detMod.isRunning()) { stopScanner(); return; }
    try {
      detMod = detMod || (await import("./detector.js"));
      await detMod.start({
        video: $("#lf-video"),
        canvas: $("#lf-canvas"),
        onStatus: (t) => { $("#lf-status").textContent = t; },
        onDetect: renderChips
      });
      $("#lf-start").textContent = "Stop scanner";
      $("#lf-off").classList.add("hidden");
      $("#lf-capture").disabled = false;
      logActivity("scanner_start", "AI object scanner");
    } catch (err) {
      stopScanner();
      $("#lf-status").textContent = cameraError(err);
    }
  };

  $("#lf-capture").onclick = () => {
    if (!detMod || !detMod.isRunning()) return;
    setPreview(detMod.snapshot($("#lf-video")));
  };

  $("#lf-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b || !detMod) return;
    const p = lastPreds[Number(b.dataset.i)];
    if (!p) return;
    $("#lf-item").value = p.class;
    setPreview(detMod.snapshot($("#lf-video"), p.bbox));
  });

  $("#lf-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = $("#lf-item").value.trim();
    const note = $("#lf-note").value.trim();
    try {
      await addDoc(collection(db, "lostfound"), {
        item, note, thumb: pendingThumb || "", status: "open",
        uid: state.user.uid, name: state.user.displayName || "", ts: serverTimestamp()
      });
      logActivity("lost_post", item);
      e.target.reset();
      setPreview("");
      toast("Posted to the board.");
    } catch (err) { toast("Could not post the item."); }
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".lost-card button[data-act]");
    if (!btn) return;
    const card = btn.closest(".lost-card");
    const item = state.cache.lost.find((x) => x.id === card.dataset.id);
    if (!item) return;
    try {
      if (btn.dataset.act === "claim") {
        const status = item.status === "claimed" ? "open" : "claimed";
        await updateDoc(doc(db, "lostfound", item.id), { status });
        logActivity("lost_" + status, item.item);
      } else if (btn.dataset.act === "delete") {
        await deleteDoc(doc(db, "lostfound", item.id));
        logActivity("lost_delete", item.item);
      }
    } catch (err) { toast("Could not update the item."); }
  });
}

function setPreview(dataUrl) {
  pendingThumb = dataUrl;
  const img = $("#lf-preview");
  img.src = dataUrl || "";
  img.classList.toggle("hidden", !dataUrl);
}

function renderChips(preds) {
  lastPreds = preds;
  const key = preds.map((p) => p.class).join(",");
  if (key === chipKey) return;
  chipKey = key;
  $("#lf-chips").innerHTML = preds.length
    ? preds.map((p, i) => `<button class="chip pick" data-i="${i}">${esc(p.class)} ${Math.round(p.score * 100)}%</button>`).join("")
    : "";
}

function stopScanner() {
  if (detMod) detMod.stop($("#lf-video"), $("#lf-canvas"));
  $("#lf-start").textContent = "Start scanner";
  $("#lf-off").classList.remove("hidden");
  $("#lf-capture").disabled = true;
  $("#lf-chips").innerHTML = "";
  chipKey = "";
}

function renderLost(sel) {
  const items = state.cache.lost;
  const me = state.user && state.user.uid;
  $(sel).innerHTML = items.length
    ? items.map((it) => {
      const canEdit = state.isAdmin || it.uid === me;
      return `
      <article class="lost-card ${it.status === "claimed" ? "claimed" : ""}" data-id="${it.id}">
        ${it.thumb ? `<img src="${it.thumb}" alt="${esc(it.item)}">` : '<div class="noimg">No photo</div>'}
        <div class="lost-body">
          <h3>${esc(it.item)}</h3>
          ${it.note ? `<p>${esc(it.note)}</p>` : ""}
          <small>Found by ${esc(it.name || "a student")} on ${fmt(it.ts)}</small>
          <span class="badge ${it.status === "claimed" ? "ok" : ""}">${it.status === "claimed" ? "Claimed" : "Waiting for owner"}</span>
          ${canEdit ? `<div class="btn-row">
            <button class="btn small" data-act="claim">${it.status === "claimed" ? "Mark as waiting" : "Mark as claimed"}</button>
            <button class="btn small danger" data-act="delete">Delete</button></div>` : ""}
        </div>
      </article>`;
    }).join("")
    : '<p class="empty">Nothing on the board yet.</p>';
}

/* ---------- password lab ---------- */
let labLogged = false;
function wirePasswordLab() {
  const input = $("#lab-pw");
  const draw = () => renderMeter($("#lab-meter"), checkPassword(input.value));
  input.addEventListener("input", () => {
    draw();
    if (!labLogged && input.value) {
      labLogged = true;
      logActivity("password_lab", "Tested a password (not saved)");
    }
  });
  draw();
}

/* ============================ ADMIN ============================ */
const nameOf = (r) => r.name || r.email || "Unknown";
const ACTION_LABELS = {
  register: "Created account", login: "Signed in", logout: "Signed out", view: "Opened page",
  room_enter: "Entered room", gesture_on: "Hand control on", gesture_off: "Hand control off",
  homework_add: "Added homework", homework_done: "Finished homework", homework_undone: "Reopened homework",
  homework_delete: "Deleted homework", attendance: "Marked attendance", scanner_start: "Started scanner",
  lost_post: "Posted lost item", lost_claimed: "Marked claimed", lost_open: "Marked waiting",
  lost_delete: "Deleted lost item", password_lab: "Used password lab",
  notice_post: "Posted announcement", notice_delete: "Deleted announcement"
};
const actionLabel = (a) => ACTION_LABELS[a] || a;

function wireAdmin() {
  $("#an-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#an-title").value.trim();
    const body = $("#an-body").value.trim();
    try {
      await addDoc(collection(db, "announcements"), {
        title, body, author: state.user.displayName || "Admin", ts: serverTimestamp()
      });
      logActivity("notice_post", title);
      e.target.reset();
      toast("Announcement posted.");
    } catch (err) { toast("Could not post the announcement."); }
  });

  $("#a-notice-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button.del");
    if (!btn) return;
    const li = btn.closest("li[data-id]");
    const n = state.cache.notices.find((x) => x.id === li.dataset.id);
    try {
      await deleteDoc(doc(db, "announcements", li.dataset.id));
      logActivity("notice_delete", n ? n.title : "");
    } catch (err) { toast("Could not delete."); }
  });

  $("#f-search").addEventListener("input", (e) => { state.filter.q = e.target.value.toLowerCase(); renderActivity(); });
  $("#f-user").addEventListener("change", (e) => { state.filter.uid = e.target.value; renderActivity(); });
  $("#f-action").addEventListener("change", (e) => { state.filter.action = e.target.value; renderActivity(); });
  $("#f-csv").onclick = downloadCsv;

  $("#aa-date").addEventListener("change", (e) => {
    if (e.target.value) subAttendance(e.target.value);
  });

  $("#u-body").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-uid]");
    if (!b) return;
    state.filter = { q: "", action: "", uid: b.dataset.uid };
    $("#f-search").value = "";
    show("a-activity");
  });
}

function renderDashboard() {
  const t = todayStr();
  const students = state.cache.users.filter((u) => !isAdminEmail(u.email));
  const eventsToday = state.cache.activity.filter((a) => {
    const d = toDate(a.ts);
    return d && todayStr(d) === t;
  }).length;
  const openLost = state.cache.lost.filter((x) => x.status !== "claimed").length;
  $("#a-stats").innerHTML = [
    [students.length, "Students signed up"],
    [eventsToday, "Events today"],
    [state.cache.attToday.length, "Present today"],
    [openLost, "Lost items waiting"]
  ].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join("");

  $("#a-recent").innerHTML = state.cache.activity.slice(0, 8).map((a) => `
    <li><div class="grow"><b>${esc(nameOf(a))}</b><span>${esc(actionLabel(a.action))}${a.detail ? ": " + esc(a.detail) : ""}</span></div><small>${fmt(a.ts)}</small></li>`
  ).join("") || '<li class="empty">No activity yet.</li>';

  const counts = {};
  state.cache.activity.forEach((a) => {
    if (isAdminEmail(a.email)) return;
    if (!counts[a.uid]) counts[a.uid] = { n: 0, a };
    counts[a.uid].n++;
  });
  const top = Object.values(counts).sort((x, y) => y.n - x.n).slice(0, 5);
  $("#a-top").innerHTML = top.map((c) => `
    <li><div class="grow"><b>${esc(nameOf(c.a))}</b></div><span>${c.n} events</span></li>`
  ).join("") || '<li class="empty">No student activity yet.</li>';
}

function fillSelect(sel, options, current) {
  const html = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (sel.dataset.sig !== html) {
    sel.innerHTML = html;
    sel.dataset.sig = html;
  }
  sel.value = current;
}

function filteredActivity() {
  const { q, action, uid } = state.filter;
  return state.cache.activity.filter((a) =>
    (!uid || a.uid === uid) &&
    (!action || a.action === action) &&
    (!q || `${a.name} ${a.email} ${a.action} ${actionLabel(a.action)} ${a.detail}`.toLowerCase().includes(q)));
}

function renderActivity() {
  const users = [["", "All users"], ...state.cache.users.map((u) => [u.id, nameOf(u)])];
  const actions = [["", "All actions"], ...[...new Set(state.cache.activity.map((a) => a.action))]
    .sort().map((a) => [a, actionLabel(a)])];
  fillSelect($("#f-user"), users, state.filter.uid);
  fillSelect($("#f-action"), actions, state.filter.action);

  const list = filteredActivity();
  $("#f-count").textContent = `Showing ${list.length} of the latest ${state.cache.activity.length} events. New events appear here live.`;
  $("#f-body").innerHTML = list.map((a) => `
    <tr>
      <td class="nowrap">${fmt(a.ts)}</td>
      <td><b>${esc(nameOf(a))}</b><br><small>${esc(a.email)}</small></td>
      <td><span class="tag tag-${esc(a.action.split("_")[0])}">${esc(actionLabel(a.action))}</span></td>
      <td>${esc(a.detail)}</td>
    </tr>`).join("") || '<tr><td colspan="4" class="empty">No events match.</td></tr>';
}

function downloadCsv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Time", "Name", "Email", "Action", "Details"].map(q).join(",")];
  filteredActivity().forEach((a) => {
    const d = toDate(a.ts);
    lines.push([d ? d.toISOString() : "", a.name, a.email, actionLabel(a.action), a.detail].map(q).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `smartschool-activity-${todayStr()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderUsers() {
  const counts = {};
  state.cache.activity.forEach((a) => { counts[a.uid] = (counts[a.uid] || 0) + 1; });
  const users = [...state.cache.users].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  $("#u-body").innerHTML = users.map((u) => `
    <tr>
      <td><b>${esc(nameOf(u))}</b> ${isAdminEmail(u.email) ? '<span class="badge admin">Admin</span>' : ""}</td>
      <td>${esc(u.email)}</td>
      <td class="nowrap">${fmtDay(u.createdAt)}</td>
      <td class="nowrap">${fmt(u.lastLogin)}</td>
      <td>${counts[u.id] || 0}</td>
      <td><button class="btn small" data-uid="${u.id}">View history</button></td>
    </tr>`).join("") || '<tr><td colspan="6" class="empty">No users yet.</td></tr>';
}

function renderAdminAttendance() {
  const date = $("#aa-date").value || todayStr();
  const present = state.cache.attSel;
  const presentIds = new Set(present.map((a) => a.uid));
  const absent = state.cache.users.filter((u) => !isAdminEmail(u.email) && !presentIds.has(u.id));
  $("#aa-present-title").textContent = `Present on ${date} (${present.length})`;
  $("#aa-absent-title").textContent = `Not marked (${absent.length})`;
  $("#aa-present").innerHTML = present
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .map((a) => `<li><div class="grow"><b>${esc(nameOf(a))}</b></div><span>${esc(a.time)}</span></li>`).join("")
    || '<li class="empty">Nobody marked present.</li>';
  $("#aa-absent").innerHTML = absent
    .map((u) => `<li><div class="grow"><b>${esc(nameOf(u))}</b></div><span>${esc(u.email)}</span></li>`).join("")
    || '<li class="empty">Everyone is marked present.</li>';
}
