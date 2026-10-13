// Password strength checker. Runs only in the browser: passwords are never saved or logged.

const COMMON = new Set([
  "password", "123456", "12345678", "qwerty", "abc123", "111111", "123123", "admin",
  "letmein", "welcome", "iloveyou", "monkey", "dragon", "football", "baseball", "master",
  "sunshine", "princess", "login", "password1", "123456789", "1234567890", "qwertyuiop",
  "school", "student", "teacher", "cricket", "12345", "1234", "000000", "987654321",
  "superman", "batman", "starwars", "whatever", "trustno1", "1q2w3e4r", "qazwsx",
  "asdfgh", "asdfghjkl", "zxcvbnm", "freedom", "shadow", "hello", "hello123", "test",
  "test123", "guest", "root", "default", "changeme", "secret", "love", "iloveu",
  "ninja", "mustang", "access", "flower", "cheese", "computer", "internet",
  "minecraft", "roblox", "fortnite", "pakistan", "india", "football1", "abcd1234"
]);

const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl", "zxcvbnm"
];

function normalize(pw) {
  const map = { "@": "a", "0": "o", "3": "e", "$": "s", "5": "s", "!": "i", "7": "t", "1": "i" };
  return pw.toLowerCase().replace(/[@03$5!71]/g, (c) => map[c]);
}

function isCommon(pw) {
  const lower = pw.toLowerCase();
  const stripped = lower.replace(/[0-9!@#$%^&*._-]+$/, "");
  return COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(normalize(pw)) ||
    COMMON.has(normalize(stripped));
}

function countSequences(pw) {
  const lower = pw.toLowerCase();
  let count = 0;
  for (let i = 0; i + 4 <= lower.length; i++) {
    const chunk = lower.slice(i, i + 4);
    const reversed = [...chunk].reverse().join("");
    if (SEQUENCES.some((s) => s.includes(chunk) || s.includes(reversed))) count++;
  }
  return count;
}

function humanTime(sec) {
  if (sec < 1) return "less than a second";
  if (sec < 60) return `${Math.round(sec)} seconds`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)} minutes`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)} hours`;
  const day = hr / 24;
  if (day < 365) return `${Math.round(day)} days`;
  const yr = day / 365;
  if (yr < 1000) return `${Math.round(yr)} years`;
  if (yr < 1e6) return `${Math.round(yr / 1000)} thousand years`;
  if (yr < 1e9) return `${Math.round(yr / 1e6)} million years`;
  return "billions of years";
}

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];

export function checkPassword(pw, personal = []) {
  const len = pw.length;
  const has = {
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw)
  };
  const checks = { length: len >= 12, ...has };
  if (!len) {
    return { score: 0, label: "Start typing", entropy: 0, crackTime: "", tips: [], checks, empty: true };
  }

  const pool = (has.lower ? 26 : 0) + (has.upper ? 26 : 0) + (has.digit ? 10 : 0) + (has.symbol ? 33 : 0);
  const bitsPerChar = Math.log2(pool || 1);
  let entropy = len * bitsPerChar;
  const tips = [];

  const repeats = pw.match(/(.)\1{2,}/g) || [];
  if (repeats.length) {
    entropy -= repeats.reduce((sum, r) => sum + (r.length - 1) * bitsPerChar, 0);
    tips.push("Avoid repeating the same character (like aaa or 111).");
  }

  const seq = countSequences(pw);
  if (seq) {
    entropy -= Math.min(seq, 6) * 5;
    tips.push("Avoid easy patterns like 1234, abcd or qwerty.");
  }

  if (isCommon(pw)) {
    entropy = Math.min(entropy, 12);
    tips.unshift("This is a very common password. Attackers try it first.");
  }

  const lower = pw.toLowerCase();
  if (personal.some((p) => p && p.length >= 3 && lower.includes(p.toLowerCase()))) {
    entropy -= 12;
    tips.push("Do not use your name or email in your password.");
  }

  entropy = Math.max(entropy, 1);
  const seconds = Math.pow(2, entropy) / 2 / 1e10; // 10 billion guesses per second
  let score = entropy < 28 ? 0 : entropy < 40 ? 1 : entropy < 56 ? 2 : entropy < 70 ? 3 : 4;

  if (len < 12) tips.push("Use at least 12 characters. Length matters most.");
  if (!has.upper || !has.lower) tips.push("Mix UPPER and lower case letters.");
  if (!has.digit) tips.push("Add a number.");
  if (!has.symbol) tips.push("Add a symbol like ! or #.");
  if (len >= 12 && score >= 3 && !tips.length) tips.push("Great. A passphrase of 4 random words is also easy to remember.");

  return {
    score,
    label: LABELS[score],
    entropy: Math.round(entropy),
    crackTime: humanTime(seconds),
    tips: tips.slice(0, 3),
    checks
  };
}

export function renderMeter(el, result) {
  const fill = result.empty ? 0 : Math.max(1, result.score);
  const check = (ok, text) => `<li class="${ok ? "ok" : ""}">${text}</li>`;
  el.innerHTML = `
    <div class="meter">
      <div class="meter-bars" data-score="${result.score}" data-fill="${fill}">
        <i></i><i></i><i></i><i></i>
      </div>
      <strong class="meter-label">${result.label}</strong>
    </div>
    ${result.crackTime ? `<p class="meter-time">A fast computer could crack this in <b>${result.crackTime}</b>.</p>` : ""}
    <ul class="meter-checks">
      ${check(result.checks.length, "12 or more characters")}
      ${check(result.checks.upper && result.checks.lower, "Upper and lower case")}
      ${check(result.checks.digit, "A number")}
      ${check(result.checks.symbol, "A symbol")}
    </ul>
    ${result.tips.length ? `<ul class="meter-tips">${result.tips.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
  `;
}
