import { save } from "/save.js";
import { allRanked, initTiers, loadTiers, progress, tierKey } from "/tiers.js";

const setEl = document.getElementById("set");
const countEl = document.getElementById("count");
const buttons = [...document.querySelectorAll(".choice")];
const resultsLinks = [...document.querySelectorAll(".results-link")];
const menuBtn = document.getElementById("menu-btn");
const menuPop = document.getElementById("menu-pop");
const doneDialog = document.getElementById("done-dialog");
const MODES = { tiers: "mode-tiers", compare: "mode-compare" };
let mode = null;

let manifest = {};
let set = null;
let current = null; // [a, b]
let next = null;    // preloaded pair
let votes = 0;
let locked = false;
let revising = false; // chose "Revise" for this set: don't nag after every re-rank

const name = (src) => decodeURIComponent(src.split("/").pop());
// Resized at build time by scripts/build-manifest.mjs; the originals are huge and aren't deployed.
const display = (src) => src.replace(/^\/images\//, "/sized/1600/").replace(/\.[^./]+$/, ".webp");

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
  save("/api/vote", { set, winner, loser });
  votes++;
  updateCount();
  await new Promise((r) => setTimeout(r, 180));
  show(next);
  locked = false;
}

function chooseSet(name) {
  set = name;
  revising = false;
  resultsLinks.forEach((a) => { a.href = `/results?set=${encodeURIComponent(set)}`; });
  try { localStorage.setItem("set", set); } catch {}
  current = null;
  show(randomPair());
  return loadTiers(set, manifest[set]);
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

// Finished ranking the set: offer the results instead of relying on the footer link.
function finished() {
  if (!revising && !doneDialog.open) doneDialog.showModal();
}

initTiers({ onChange: updateCount, onDone: finished });
doneDialog.addEventListener("close", () => {
  if (doneDialog.returnValue === "revise") revising = true;
  doneDialog.returnValue = "";
});
// Escape and backdrop clicks count as "Revise".
doneDialog.addEventListener("cancel", () => { revising = true; });
doneDialog.addEventListener("click", (e) => {
  if (e.target === doneDialog) { revising = true; doneDialog.close(); }
});
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
  if (e.target === setEl || doneDialog.open) return;
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
  await chooseSet(setEl.value);
  // Already finished this set: land on the results so it doesn't look like progress was lost.
  // "Back" on the results page links here with ?edit to get back to the board.
  const edit = new URLSearchParams(location.search).has("edit");
  if (!edit && mode === "tiers" && allRanked()) location.replace(`/results?set=${encodeURIComponent(set)}`);
})();
