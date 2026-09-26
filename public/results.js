const items = new Map(); // src -> result row, for the viewer caption

(async () => {
  const params = new URLSearchParams(location.search);
  let set = params.get("set");
  if (!set) {
    const res = await fetch("/api/manifest");
    if (res.status === 401) return location.replace("/login");
    set = Object.keys(await res.json())[0];
    if (!set) return;
  }
  const res = await fetch(`/api/results?set=${encodeURIComponent(set)}`);
  if (res.status === 401) return location.replace("/login");
  const data = await res.json();
  if (!res.ok) { document.getElementById("summary").textContent = data.error; return; }

  document.getElementById("title").textContent = set;
  document.getElementById("summary").textContent = `${data.totalVotes} votes · ranked by Elo`;
  renderTiers(data.ranked);
  for (const item of data.ranked) items.set(item.src, item);
  const list = document.getElementById("list");
  data.ranked.forEach((item, i) => {
    const li = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = i + 1;
    const img = document.createElement("img");
    img.src = `${item.src}?w=160`;
    img.loading = "lazy";
    img.alt = "";
    img.dataset.src = item.src;
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = decodeURIComponent(item.src.split("/").pop());
    const score = document.createElement("span");
    score.className = "score";
    score.innerHTML = `${item.elo}<small>${item.wins}–${item.losses}</small>`;
    li.append(rank, img, nameEl, score);
    list.append(li);
  });
})();

// Each image lands in the tier closest to its average rating (S=3, A=2, B=1, don't use=0).
const TIERS = [["S", "S"], ["A", "A"], ["B", "B"], ["X", "Don't put on site"]];
const SCORE = { S: 3, A: 2, B: 1, X: 0 };

function renderTiers(ranked) {
  const rated = ranked
    .map((item) => {
      const n = Object.values(item.tiers).reduce((a, b) => a + b, 0);
      const avg = n ? Object.entries(item.tiers).reduce((sum, [t, c]) => sum + SCORE[t] * c, 0) / n : null;
      return { ...item, n, avg };
    })
    .filter((item) => item.n)
    .sort((a, b) => b.avg - a.avg || b.n - a.n);
  if (!rated.length) return;

  document.getElementById("tier-summary").textContent =
    `${rated.length} of ${ranked.length} images rated · placed by average`;
  const board = document.getElementById("tier-board");
  for (const [key, label] of TIERS) {
    const row = document.createElement("div");
    row.className = "tier";
    row.dataset.tier = key;
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    for (const item of rated.filter((i) => ["X", "B", "A", "S"][Math.round(i.avg)] === key)) {
      const img = document.createElement("img");
      img.src = `${item.src}?w=160`;
      img.loading = "lazy";
      img.alt = decodeURIComponent(item.src.split("/").pop());
      img.dataset.src = item.src;
      img.title = `${img.alt}\n` + Object.entries(item.tiers).filter(([, c]) => c).map(([t, c]) => `${t === "X" ? "Don't use" : t}: ${c}`).join(" · ");
      thumbs.append(img);
    }
    row.append(labelEl, thumbs);
    board.append(row);
  }
  document.getElementById("tier-results").hidden = false;
}

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
  const container = row?.querySelector(".thumbs") ?? document.getElementById("list");
  seq = [...container.querySelectorAll("img[data-src]")].map((img) => img.dataset.src);
  group = row ? `in ${TIER_NAMES[row.dataset.tier]}` : "by Elo";
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
  viewerImg.src = `${src}?w=160`;
  viewerImg.alt = name;
  const large = new Image();
  large.onload = () => { if (viewerImg.alt === name) viewerImg.src = large.src; };
  large.src = `${src}?w=1600`;
  // Warm the neighbours so stepping through is instant.
  for (const n of [seq[i - 1], seq[i + 1]]) if (n) new Image().src = `${n}?w=1600`;

  const tiers = Object.entries(item?.tiers ?? {})
    .filter(([, n]) => n)
    .map(([t, n]) => `${t === "X" ? "Don't use" : t} ×${n}`)
    .join(" · ");
  caption.textContent = [`${i + 1} / ${seq.length} ${group}`, name, tiers, item && `Elo ${item.elo} (${item.wins}–${item.losses})`]
    .filter(Boolean)
    .join(" · ");
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i === seq.length - 1;
}

document.querySelector("main").addEventListener("click", (e) => {
  const img = e.target.closest("img[data-src]");
  if (img) openViewer(img);
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
