// Tier mode: hold the image, the S / A / B / "Don't put on site" rows appear behind it,
// drop it into one. Tapping (no drag) leaves the rows open so you can tap a row instead.
const card = document.getElementById("card");
const board = document.getElementById("board");
const rows = [...board.querySelectorAll(".tier")];
const undoBtn = document.getElementById("undo");
const hintEl = document.getElementById("hint");

const KEYS = { 1: "S", 2: "A", 3: "B", 4: "X", s: "S", a: "A", b: "B", x: "X" };
const HELD_SCALE = 0.4;
const HINT = "Hold the image, drop it in a row";

let set = null;
let images = [];
let placed = {};    // src -> tier
let history = [];   // [{ src, prev }] for undo
let current = null;
let drag = null;    // { id, x0, y0, moved, over }
let tapOpen = false; // rows left open after a tap
let busy = false;
let onChange = () => {};

const name = (src) => decodeURIComponent(src.split("/").pop());
// Resized by the Worker; the originals are far too big to drag around or show as thumbnails.
const display = (src) => `${src}?w=1600`;
const thumb = (src) => `${src}?w=160`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function initTiers(opts) {
  onChange = opts.onChange;
}

export function progress() {
  return images.length ? `${Object.keys(placed).length} / ${images.length} ranked` : "";
}

export function allRanked() {
  return images.length > 0 && images.every((src) => placed[src]);
}

export async function loadTiers(setName, setImages) {
  set = setName;
  images = setImages;
  placed = {};
  history = [];
  undoBtn.disabled = true;
  const res = await fetch(`/api/tiers?set=${encodeURIComponent(set)}`);
  if (res.status === 401) return location.replace("/login");
  if (set !== setName) return; // switched sets while loading
  if (res.ok) {
    const saved = await res.json();
    for (const src of images) if (saved[src]) placed[src] = saved[src];
  }
  renderRows();
  show(nextUnplaced());
}

export function tierKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
    return;
  }
  const tier = KEYS[e.key.toLowerCase()];
  if (tier) assign(tier);
  else if (e.key === "u") undo();
  else if (e.key === "Escape" && tapOpen) closeBoard();
}

// ---------- state ----------

const nextUnplaced = (after) => {
  const start = after ? images.indexOf(after) + 1 : 0;
  return [...images.slice(start), ...images.slice(0, start)].find((src) => !placed[src]) ?? null;
};

function show(src) {
  current = src;
  resetCard(true);
  if (!src) {
    // Everything ranked: leave the board up as the finished tier list.
    card.hidden = true;
    board.classList.add("open", "done");
    hintEl.textContent = images.length ? "All ranked · tap one to re-rank" : "";
  } else {
    card.hidden = false;
    card.src = display(src);
    card.alt = name(src);
    board.classList.remove("open", "done");
    hintEl.textContent = HINT;
    const upcoming = nextUnplaced(src);
    if (upcoming && upcoming !== src) new Image().src = display(upcoming);
  }
  onChange();
}

function renderRows() {
  for (const row of rows) {
    const thumbs = images
      .filter((src) => placed[src] === row.dataset.tier)
      .map((src) => {
        const img = document.createElement("img");
        img.src = thumb(src);
        img.alt = name(src);
        img.title = name(src);
        img.loading = "lazy";
        img.draggable = false;
        img.dataset.src = src;
        return img;
      });
    row.querySelector(".thumbs").replaceChildren(...thumbs);
  }
}

async function assign(tier) {
  if (busy || !current) return;
  busy = true;
  const src = current;
  history.push({ src, prev: placed[src] ?? null });
  undoBtn.disabled = false;
  placed[src] = tier;
  save(src, tier);

  const row = rows.find((r) => r.dataset.tier === tier);
  board.classList.add("open");
  renderRows();
  row.classList.add("hit");
  card.classList.remove("dragging");
  card.classList.add("dropped");
  await sleep(320);
  row.classList.remove("hit");
  tapOpen = false;
  show(nextUnplaced(src));
  busy = false;
}

function undo() {
  if (busy || drag) return;
  const last = history.pop();
  if (!last) return;
  undoBtn.disabled = !history.length;
  if (last.prev) placed[last.src] = last.prev;
  else delete placed[last.src];
  save(last.src, last.prev);
  renderRows();
  tapOpen = false;
  show(last.src);
}

function save(image, tier) {
  fetch("/api/tier", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set, image, tier }),
  }).then((res) => {
    if (res.status === 401) location.replace("/login");
  });
}

// ---------- drag ----------

// snap: jump straight back (a new image), instead of gliding back (a cancelled drag).
function resetCard(snap = false) {
  if (snap) card.style.transition = "none";
  card.classList.remove("dragging", "dropped", "held");
  card.style.transform = "";
  if (snap) {
    card.offsetWidth; // flush styles so the transition stays off for this change
    card.style.transition = "";
  }
}

function closeBoard() {
  tapOpen = false;
  resetCard();
  board.classList.remove("open");
  hintEl.textContent = HINT;
}

const rowAt = (x, y) =>
  rows.find((r) => {
    const b = r.getBoundingClientRect();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  }) ?? null;

function setOver(row) {
  if (drag.over === row) return;
  drag.over?.classList.remove("over");
  row?.classList.add("over");
  drag.over = row;
}

card.addEventListener("pointerdown", (e) => {
  if (busy || !current || drag || e.button !== 0) return;
  e.preventDefault();
  card.setPointerCapture(e.pointerId);
  const r = card.getBoundingClientRect();
  // Shrink around the grab point so the image stays under the finger/cursor.
  card.style.transformOrigin = `${e.clientX - r.left}px ${e.clientY - r.top}px`;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, over: null, wasOpen: tapOpen };
  card.classList.add("held");
  card.style.transform = `scale(${HELD_SCALE})`;
  board.classList.add("open");
});

card.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  if (!drag.moved && Math.hypot(dx, dy) > 6) {
    drag.moved = true;
    card.classList.add("dragging");
  }
  card.style.transform = `translate(${dx}px, ${dy}px) scale(${HELD_SCALE})`;
  setOver(rowAt(e.clientX, e.clientY));
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const { over, moved, wasOpen } = drag;
  setOver(null);
  drag = null;
  card.classList.remove("held");
  if (!cancelled && moved && over) {
    assign(over.dataset.tier);
  } else if (!cancelled && !moved && !wasOpen) {
    // A tap: keep the rows up and let the user tap one.
    tapOpen = true;
    card.classList.remove("dragging");
    card.style.transform = `scale(${HELD_SCALE})`;
    hintEl.textContent = "Tap a row";
  } else {
    closeBoard();
  }
}
card.addEventListener("pointerup", (e) => endDrag(e, false));
card.addEventListener("pointercancel", (e) => endDrag(e, true));
card.addEventListener("contextmenu", (e) => e.preventDefault());

board.addEventListener("click", (e) => {
  if (board.classList.contains("done")) {
    const thumb = e.target.closest("img[data-src]");
    if (thumb) show(thumb.dataset.src);
    return;
  }
  if (!tapOpen) return;
  const row = e.target.closest(".tier");
  if (row) assign(row.dataset.tier);
  else closeBoard();
});
