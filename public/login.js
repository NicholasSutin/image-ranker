const inputs = [...document.querySelectorAll("#digits input")];
const whoInvite = document.getElementById("who-invite");
const whoName = document.getElementById("who-name");
const codeStep = document.getElementById("code-step");
const nameInput = document.getElementById("name");
const errorEl = document.getElementById("error");
const widgetEl = document.getElementById("turnstile");
let token = null;
let widgetId = null;
let busy = false;

// Define the onload callback *before* loading Turnstile, otherwise the script can
// finish first, find no callback, and never render the widget.
window.onTurnstileLoad = () => {
  widgetId = turnstile.render(widgetEl, {
    sitekey: widgetEl.dataset.sitekey,
    size: "flexible",
    callback: (t) => { token = t; errorEl.textContent = ""; maybeSubmit(); },
    "expired-callback": () => { token = null; },
    "error-callback": (code) => {
      token = null;
      errorEl.textContent = `Verification error (${code}). Refresh to retry.`;
      return true;
    },
  });
};
const turnstileScript = document.createElement("script");
turnstileScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
turnstileScript.async = true;
turnstileScript.onerror = () => { errorEl.textContent = "Couldn't load verification. Check your connection or ad blocker."; };
document.head.append(turnstileScript);

// ---------- who are you ----------

// Invite links look like /?invite=Farzana; the Worker passes the label through to /login.
const invite = (new URLSearchParams(location.search).get("invite") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
let name = "";

function step(el) {
  for (const s of [whoInvite, whoName, codeStep]) s.hidden = s !== el;
  errorEl.textContent = "";
}

function askName() {
  step(whoName);
  nameInput.focus();
}

function useName(n) {
  name = n;
  document.getElementById("hello-name").textContent = n;
  step(codeStep);
  inputs[0].focus();
}

if (invite) {
  document.getElementById("invite-name").textContent = invite;
  step(whoInvite);
} else {
  askName();
}
document.getElementById("who-yes").addEventListener("click", () => useName(invite));
document.getElementById("who-no").addEventListener("click", askName);
document.getElementById("not-me").addEventListener("click", () => {
  nameInput.value = "";
  askName();
});

function submitName() {
  const n = nameInput.value.trim().replace(/\s+/g, " ");
  if (!n) { errorEl.textContent = "Enter your name."; nameInput.focus(); return; }
  useName(n);
}

// ---------- code ----------

const code = () => inputs.map((i) => i.value).join("");

function fill(from, text) {
  const digits = text.replace(/\D/g, "").split("");
  for (let i = from; i < inputs.length && digits.length; i++) inputs[i].value = digits.shift();
}

inputs.forEach((input, i) => {
  input.addEventListener("input", () => {
    if (input.value.length > 1) fill(i, input.value); // iOS autofill / paste
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
    maybeSubmit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
  });
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    fill(i, e.clipboardData.getData("text"));
    inputs[Math.min(code().length, inputs.length - 1)].focus();
    maybeSubmit();
  });
});

async function maybeSubmit() {
  if (busy || code().length !== inputs.length) return;
  if (!token) { errorEl.textContent = "Complete the check below."; return; }
  busy = true;
  errorEl.textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code(), token, name, invite: invite || null }),
    });
    if (res.ok) return location.replace("/");
    const data = await res.json().catch(() => ({}));
    errorEl.textContent = data.error || "Something went wrong.";
    inputs.forEach((i) => (i.value = ""));
    inputs[0].focus();
    const digits = document.getElementById("digits");
    digits.classList.remove("shake");
    void digits.offsetWidth;
    digits.classList.add("shake");
  } finally {
    // Turnstile tokens are single-use: always get a fresh one.
    token = null;
    if (widgetId !== null) turnstile.reset(widgetId);
    busy = false;
  }
}

document.getElementById("form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!whoName.hidden) submitName();
  else if (!codeStep.hidden) maybeSubmit();
});
