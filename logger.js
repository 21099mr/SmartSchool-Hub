import { auth, db, addDoc, collection, serverTimestamp } from "./firebase.js";

// Saves one line of history for the admin. Never pass passwords or private data here.
export async function logActivity(action, detail = "") {
  const user = auth && auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, "activity"), {
      uid: user.uid,
      name: user.displayName || "",
      email: user.email || "",
      action,
      detail: String(detail).slice(0, 200),
      ts: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not save activity:", err);
  }
}
