const items = new Map(); // src -> result row, for the viewer caption
const MIN_FAVORITES = 3;

let set = null;
let data = null;
let mine = new Set(); // srcs the viewed person has starred
let picking = false;
let me = null;        // { id, name }
let people = null;    // everyone's progress in this set
let viewing = null;   // user id whose results are shown
const pendingStars = new Set();

const main = document.querySelector("main");
const favPrompt = document.getElementById("fav-prompt");
const favBar = document.getElementById("fav-bar");
const favCount = document.getElementById("fav-count");
const favDone = document.getElementById("fav-done");
const favEdit = document.getElementById("fav-edit");

const fileName = (src) => decodeURIComponent(src.split("/").pop());
// Resized at build time by scripts/build-manifest.mjs; the originals are huge and aren't deployed.
const sized = (src, width) => src.replace(/^\/images\//, `/sized/${width}/`).replace(/\.[^./]+$/, ".webp");

(async () => {
  const params = new URLSearchParams(location.search);
  set = params.get("set");
  if (!set) {
    const res = await fetch("/api/manifest");
    if (res.status === 401) return location.replace("/login");
    set = Object.keys(await res.json())[0];
    if (!set) return;
  }
  document.getElementById("title").textContent = set;

  const res = await fetch("/api/me");
  if (res.status === 401) return location.replace("/login");
  me = await res.json();
  document.getElementById("whoami").textContent = me.name ? `Signed in as ${me.name}` : "";
  viewing = params.get("user") || me.id;
  await loadPeople();
  await load();
})();

const isMine = () => viewing === me.id;

async function load() {
  const who = isMine() ? "" : `&user=${encodeURIComponent(viewing)}`;
  const res = await fetch(`/api/results?set=${encodeURIComponent(set)}${who}`);
  if (res.status === 401) return location.replace("/login");
  const body = await res.json();
  if (!res.ok) { document.getElementById("summary").textContent = body.error; return; }
  data = body;
  mine = new Set(data.ranked.filter((i) => i.starred).map((i) => i.src));
  render();
}

// Starred images move out of the tiers and the Elo list into their own gallery.
function render() {
  items.clear();
  for (const item of data.ranked) items.set(item.src, item);
  const starred = data.ranked.filter((i) => i.starred);
  const rest = data.ranked.filter((i) => !i.starred);
  renderStarred(starred);
  renderTiers(rest);
  renderList(rest);
  updateFavorites();
}

// A square photo tile. The <img> carries data-src so the viewer and star-picking can find it.
function tile(item, title = fileName(item.src)) {
  const el = document.createElement("span");
  el.className = "tile";
  el.classList.toggle("mine", mine.has(item.src));
  const img = document.createElement("img");
  img.src = sized(item.src, 800);
  img.loading = "lazy";
  img.alt = fileName(item.src);
  img.title = title;
  img.dataset.src = item.src;
  el.append(img);
  return el;
}

function renderStarred(starred) {
  const section = document.getElementById("starred");
  section.hidden = !starred.length;
  document.getElementById("starred-summary").textContent =
    `${starred.length} image${starred.length === 1 ? "" : "s"}`;
  document.getElementById("starred-grid").replaceChildren(...starred.map((item) => tile(item)));
}

function renderList(rest) {
  document.getElementById("summary").textContent = `${data.totalVotes} votes · ranked by Elo`;
  document.getElementById("list").replaceChildren(
    ...rest.map((item, i) => {
      const li = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = i + 1;
      const nameEl = document.createElement("span");
      nameEl.className = "name";
      nameEl.textContent = fileName(item.src);
      const score = document.createElement("span");
      score.className = "score";
      score.innerHTML = `${item.elo}<small>${item.wins}–${item.losses}</small>`;
      li.append(rank, tile(item), nameEl, score);
      return li;
    }),
  );
}

const TIERS = [["S", "S"], ["A", "A"], ["B", "B"], ["X", "Don't put on site"]];

function renderTiers(rest) {
  const rated = rest.filter((item) => item.tier);
  const section = document.getElementById("tier-results");
  section.hidden = !rated.length;
  if (!rated.length) return;

  document.getElementById("tier-summary").textContent = `${rated.length} of ${rest.length} images ranked`;
  const board = document.getElementById("tier-board");
  board.replaceChildren();
  for (const [key, label] of TIERS) {
    const row = document.createElement("div");
    row.className = "tier";
    row.dataset.tier = key;
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    thumbs.append(...rated.filter((i) => i.tier === key).map((item) => tile(item)));
    row.append(labelEl, thumbs);
    board.append(row);
  }
}

// ---------- people ----------

async function loadPeople() {
  const res = await fetch(`/api/people?set=${encodeURIComponent(set)}`);
  if (!res.ok) return;
  people = await res.json();
  renderPeople();
}

function renderPeople() {
  const nav = document.getElementById("people");
  nav.hidden = false;
  // You first, then everyone else by when they started.
  const list = [...people.people].sort((a, b) => (b.id === me.id) - (a.id === me.id));
  nav.replaceChildren(
    ...list.map((p) => {
      const btn = document.createElement("button");
      btn.className = "person";
      btn.setAttribute("aria-pressed", p.id === viewing);
      const nameEl = document.createElement("span");
      nameEl.textContent = p.id === me.id ? `${p.name} (you)` : p.name;
      const progress = document.createElement("small");
      progress.textContent = p.finishedAt ? "✓ done" : `${p.tiered}/${people.total}`;
      btn.append(nameEl, progress);
      btn.addEventListener("click", () => switchTo(p.id));
      return btn;
    }),
  );
  renderPerson();
}

async function switchTo(id) {
  if (id === viewing) return;
  viewing = id;
  picking = false;
  const params = new URLSearchParams(location.search);
  params.set("set", set);
  if (isMine()) params.delete("user");
  else params.set("user", id);
  history.replaceState(null, "", `?${params}`);
  renderPeople();
  await load();
}

const when = (ts) => ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function duration(seconds) {
  if (seconds < 60) return seconds ? "under a minute" : "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

const place = (l) => [l.city, l.region, l.country].filter(Boolean).join(", ") || "Unknown location";

// Start, end, time spent and where they signed in from, for the person being viewed.
function renderPerson() {
  const p = people.people.find((x) => x.id === viewing);
  const card = document.getElementById("person-card");
  card.hidden = !p;
  if (!p) return;

  const rows = [
    ["Started", when(p.startedAt)],
    ["Finished", p.finishedAt ? when(p.finishedAt) : "Not yet"],
    ["Time spent", duration(p.activeSeconds)],
    ["Last seen", when(p.lastSeenAt)],
    ["Progress", `${p.tiered} of ${people.total} tiered · ${p.starred} starred · ${p.votes} This or That votes`],
  ];
  if (p.invite) rows.push(["Invite link", p.invite]);

  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }

  // Each distinct place they signed in from, most recent first.
  const places = new Map();
  for (const l of p.logins) {
    const key = place(l);
    const entry = places.get(key) ?? { ...l, count: 0 };
    entry.count++;
    places.set(key, entry);
  }
  const dt = document.createElement("dt");
  dt.textContent = places.size > 1 ? "Locations" : "Location";
  const dd = document.createElement("dd");
  if (!places.size) dd.textContent = "—";
  for (const [key, l] of places) {
    const line = document.createElement("div");
    const label = l.latitude != null ? document.createElement("a") : document.createElement("span");
    label.textContent = key;
    if (l.latitude != null) {
      label.href = `https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=10/${l.latitude}/${l.longitude}`;
      label.target = "_blank";
      label.rel = "noopener";
    }
    const meta = document.createElement("small");
    meta.textContent = ` · ${l.count} login${l.count === 1 ? "" : "s"}, last ${when(l.at)}${l.timezone ? ` · ${l.timezone}` : ""}`;
    line.append(label, meta);
    dd.append(line);
  }
  dl.append(dt, dd);

  const heading = document.createElement("h2");
  heading.textContent = p.id === me.id ? `${p.name} (you)` : p.name;
  card.replaceChildren(heading, dl);
}

// ---------- favorites ----------

// Once every image is in a tier, ask for the absolute favorites. Only for your own results.
function updateFavorites() {
  const done = data.ranked.every((i) => i.tier);
  const own = isMine();
  favPrompt.hidden = !own || picking || !done || mine.size >= MIN_FAVORITES;
  favEdit.hidden = !own || picking || !(done || mine.size);
  favBar.hidden = !picking;
  main.classList.toggle("picking", picking);
  const need = MIN_FAVORITES - mine.size;
  favCount.textContent = need > 0
    ? `${mine.size} starred · pick ${need} more`
    : `${mine.size} starred`;
  favDone.disabled = need > 0;
}

function startPicking() {
  picking = true;
  updateFavorites();
}

async function finishPicking() {
  picking = false;
  favDone.disabled = true;
  await Promise.all(pendingStars); // make sure every pick is saved before finishing
  await fetch("/api/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set }),
  });
  await loadPeople();
  await load(); // re-render so the picks move into Starred
  document.getElementById("starred").scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleStar(src) {
  const starred = !mine.has(src);
  if (starred) mine.add(src);
  else mine.delete(src);
  // The same image can appear in both the tiers and the Elo list.
  for (const img of document.querySelectorAll("img[data-src]")) {
    if (img.dataset.src === src) img.parentElement.classList.toggle("mine", starred);
  }
  updateFavorites();
  const req = fetch("/api/star", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set, image: src, starred }),
  }).then((res) => {
    if (res.status === 401) location.replace("/login");
  }).catch(() => {});
  pendingStars.add(req);
  req.finally(() => pendingStars.delete(req));
}

document.getElementById("fav-start").addEventListener("click", startPicking);
favEdit.addEventListener("click", startPicking);
favDone.addEventListener("click", finishPicking);

// ---------- viewer ----------

const viewer = document.getElementById("viewer");
const viewerImg = viewer.querySelector("img");
const caption = viewer.querySelector(".caption");
const prevBtn = document.getElementById("viewer-prev");
const nextBtn = document.getElementById("viewer-next");
const TIER_NAMES = Object.fromEntries(TIERS);

let seq = [];   // srcs the arrows step through: the clicked image's tier row, or the Elo list
let group = ""; // e.g. "in S"
let pos = 0;

function openViewer(thumb) {
  const row = thumb.closest(".tier");
  const container = thumb.closest(".thumbs, #starred-grid, #list");
  seq = [...container.querySelectorAll("img[data-src]")].map((img) => img.dataset.src);
  group = row ? `in ${TIER_NAMES[row.dataset.tier]}` : container.id === "starred-grid" ? "starred" : "by Elo";
  show(seq.indexOf(thumb.dataset.src));
  viewer.showModal();
}

function show(i) {
  if (i < 0 || i >= seq.length) return;
  pos = i;
  const src = seq[i];
  const item = items.get(src);
  const name = decodeURIComponent(src.split("/").pop());
  // Show the already-loaded thumbnail instantly, then swap in the large version.
  viewerImg.src = sized(src, 800);
  viewerImg.alt = name;
  const large = new Image();
  large.onload = () => { if (viewerImg.alt === name) viewerImg.src = large.src; };
  large.src = sized(src, 1600);
  // Warm the neighbours so stepping through is instant.
  for (const n of [seq[i - 1], seq[i + 1]]) if (n) new Image().src = sized(n, 1600);

  const tier = item?.tier ? `Tier ${TIER_NAMES[item.tier]}` : "";
  caption.textContent = [`${i + 1} / ${seq.length} ${group}`, name, item?.starred && "★", tier, item && `Elo ${item.elo} (${item.wins}–${item.losses})`]
    .filter(Boolean)
    .join(" · ");
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i === seq.length - 1;
}

main.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-src]");
  if (!img) return;
  if (picking) toggleStar(img.dataset.src);
  else openViewer(img);
});
prevBtn.addEventListener("click", (e) => { e.stopPropagation(); show(pos - 1); });
nextBtn.addEventListener("click", (e) => { e.stopPropagation(); show(pos + 1); });
viewer.addEventListener("click", () => viewer.close());
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") show(pos - 1);
  if (e.key === "ArrowRight") show(pos + 1);
});

// Swipe left/right on touch screens.
let touchX = null;
viewer.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
viewer.addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) {
    e.preventDefault(); // don't let the tap-to-close click fire
    show(dx < 0 ? pos + 1 : pos - 1);
  }
});
