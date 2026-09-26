import { initTiers, loadTiers, progress, tierKey } from "/tiers.js";

const setEl = document.getElementById("set");
const countEl = document.getElementById("count");
const buttons = [...document.querySelectorAll(".choice")];
const resultsLinks = [...document.querySelectorAll(".results-link")];
const menuBtn = document.getElementById("menu-btn");
const menuPop = document.getElementById("menu-pop");
const MODES = { tiers: "mode-tiers", compare: "mode-compare" };
let mode = null;

let manifest = {};
let set = null;
let current = null; // [a, b]
let next = null;    // preloaded pair
let votes = 0;
let locked = false;

const name = (src) => decodeURIComponent(src.split("/").pop());
const display = (src) => `${src}?w=1600`; // resized by the Worker; originals are huge

function randomPair() {
  const images = manifest[set];
  let a, b;
  do {
    a = images[Math.floor(Math.random() * images.length)];
    b = images[Math.floor(Math.random() * images.length)];
    // avoid self-matches and immediate repeats of the pair on screen
  } while (a === b || (current && images.length > 2 && current.includes(a) && current.includes(b)));
  return [a, b];
}

function preload(pair) {
  pair.forEach((src) => { new Image().src = display(src); });
  return pair;
}

function show(pair) {
  current = pair;
  buttons.forEach((btn, i) => {
    btn.classList.remove("picked");
    const img = btn.querySelector("img");
    img.src = display(pair[i]);
    img.alt = name(pair[i]);
  });
  next = preload(randomPair());
}

async function pick(side) {
  if (locked || !current) return;
  locked = true;
  buttons[side].classList.add("picked");
  const winner = current[side];
  const loser = current[1 - side];
  fetch("/api/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set, winner, loser }),
  }).then((res) => {
    if (res.status === 401) location.replace("/login");
  });
  votes++;
  updateCount();
  await new Promise((r) => setTimeout(r, 180));
  show(next);
  locked = false;
}

function chooseSet(name) {
  set = name;
  resultsLinks.forEach((a) => { a.href = `/results?set=${encodeURIComponent(set)}`; });
  try { localStorage.setItem("set", set); } catch {}
  current = null;
  show(randomPair());
  loadTiers(set, manifest[set]);
}

// ---------- modes ----------

function updateCount() {
  countEl.textContent = mode === "tiers" ? progress() : votes ? `${votes} picked` : "";
}

function setMode() {
  mode = location.hash === "#compare" ? "compare" : "tiers";
  for (const [key, id] of Object.entries(MODES)) document.getElementById(id).hidden = key !== mode;
  menuPop.querySelectorAll("a").forEach((a) => {
    a.toggleAttribute("aria-current", a.dataset.mode === mode);
  });
  updateCount();
}

function toggleMenu(open) {
  menuPop.hidden = !open;
  menuBtn.setAttribute("aria-expanded", open);
}

initTiers({ onChange: updateCount });
setMode();
window.addEventListener("hashchange", setMode);
menuBtn.addEventListener("click", () => toggleMenu(menuPop.hidden));
menuPop.addEventListener("click", () => toggleMenu(false));
document.addEventListener("click", (e) => {
  if (!menuPop.hidden && !e.target.closest("#menu")) toggleMenu(false);
});

buttons.forEach((btn, i) => btn.addEventListener("click", () => pick(i)));
document.getElementById("skip").addEventListener("click", () => current && show(next));
setEl.addEventListener("change", () => chooseSet(setEl.value));
document.addEventListener("keydown", (e) => {
  if (e.target === setEl) return;
  if (e.key === "Escape" && !menuPop.hidden) return toggleMenu(false);
  if (mode === "tiers") return tierKey(e);
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") pick(0);
  if (e.key === "ArrowRight" || e.key === "ArrowDown") pick(1);
});

(async () => {
  const res = await fetch("/api/manifest");
  if (res.status === 401) return location.replace("/login");
  manifest = await res.json();
  const sets = Object.keys(manifest);
  if (!sets.length) {
    countEl.textContent = "No images yet — add some to public/images/<set>/";
    return;
  }
  setEl.innerHTML = sets.map((s) => `<option>${s.replace(/</g, "&lt;")}</option>`).join("");
  setEl.hidden = sets.length < 2;
  let saved = null;
  try { saved = localStorage.getItem("set"); } catch {}
  setEl.value = sets.includes(saved) ? saved : sets[0];
  chooseSet(setEl.value);
})();
