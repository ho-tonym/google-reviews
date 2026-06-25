// ---------------------------------------------------------------------------
// Tracked name groups. Each group counts as ONE mention per review if the
// review text contains ANY of its aliases as a whole word (case-insensitive).
// Edit this list to add names or nickname variants.
// ---------------------------------------------------------------------------
const TRACKED_GROUPS = [
  { aliases: ["Victoria", "Vicky", "Vicki", "Tori"] },
  { aliases: ["Sam", "Sammy", "Samantha"] },
];

const STORE_FILES = ["columbus", "hudson-yards", "lexington"];

const els = {
  stores: document.getElementById("stores"),
  creditsValue: document.getElementById("creditsValue"),
  creditsSub: document.getElementById("creditsSub"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  lastUpdated: document.getElementById("lastUpdated"),
};

const state = {
  stores: [], // [{ store, reviews }]
  groups: TRACKED_GROUPS.map((g) => ({
    label: g.aliases.join(" / "),
    aliases: g.aliases,
    regex: buildGroupRegex(g.aliases),
  })),
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildGroupRegex(aliases) {
  const alt = aliases.map(escapeRegex).join("|");
  return new RegExp(`\\b(?:${alt})\\b`, "i");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadAll() {
  let meta = null;
  try {
    meta = await fetch("data/meta.json").then((r) => (r.ok ? r.json() : null));
  } catch {
    meta = null;
  }
  renderCredits(meta);
  renderLastUpdated(meta);

  const results = await Promise.all(
    STORE_FILES.map(async (id) => {
      try {
        const data = await fetch(`data/${id}.json`).then((r) => (r.ok ? r.json() : null));
        return data;
      } catch {
        return null;
      }
    })
  );
  state.stores = results.filter(Boolean);
  render();
}

function renderCredits(meta) {
  const c = meta?.credits_remaining;
  els.creditsValue.textContent = typeof c === "number" ? c.toLocaleString() : "unknown";
  els.creditsSub.textContent = meta?.generated_at
    ? `as of ${new Date(meta.generated_at).toLocaleDateString()}`
    : "no data yet";
}

function renderLastUpdated(meta) {
  if (meta?.generated_at) {
    els.lastUpdated.textContent = `Last refreshed ${new Date(meta.generated_at).toLocaleString()}`;
  } else {
    els.lastUpdated.textContent = "No data yet - run the refresh workflow.";
  }
}

function currentRange() {
  const from = els.dateFrom.value ? new Date(els.dateFrom.value + "T00:00:00") : null;
  const to = els.dateTo.value ? new Date(els.dateTo.value + "T23:59:59") : null;
  return { from, to };
}

function filterByDate(reviews, { from, to }) {
  if (!from && !to) return reviews;
  return reviews.filter((rev) => {
    if (!rev.iso_date) return false;
    const d = new Date(rev.iso_date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function rankGroups(reviews) {
  const ranking = state.groups.map((group) => {
    const matches = reviews.filter((rev) => group.regex.test(rev.text || ""));
    return { label: group.label, count: matches.length, matches };
  });
  ranking.sort((a, b) => b.count - a.count);
  return ranking;
}

function render() {
  if (state.stores.length === 0) {
    els.stores.innerHTML = `<p class="loading">No store data available yet.</p>`;
    return;
  }
  const range = currentRange();
  els.stores.innerHTML = "";

  for (const data of state.stores) {
    const filtered = filterByDate(data.reviews, range);
    const ranking = rankGroups(filtered);
    const maxCount = Math.max(1, ...ranking.map((r) => r.count));

    const col = document.createElement("section");
    col.className = "store";

    const rating = data.store.rating != null ? data.store.rating.toFixed(1) : "--";
    const total = data.store.total_reviews ?? data.reviews.length;

    col.innerHTML = `
      <header class="store__head">
        <h2>${escapeHtml(data.store.label)}</h2>
        <p class="store__addr">${escapeHtml(data.store.address)}</p>
        <div class="store__stats">
          <span class="stat"><strong>${rating}</strong>&#9733; avg</span>
          <span class="stat"><strong>${Number(total).toLocaleString()}</strong> total reviews</span>
          <span class="stat"><strong>${filtered.length.toLocaleString()}</strong> in range</span>
        </div>
      </header>
      <ol class="ranking"></ol>
    `;

    const list = col.querySelector(".ranking");
    ranking.forEach((row, i) => {
      const li = document.createElement("li");
      li.className = "rank-row" + (row.count === 0 ? " rank-row--empty" : "");

      const reviewsHtml = row.matches
        .slice()
        .sort((a, b) => (b.iso_date || "").localeCompare(a.iso_date || ""))
        .map(
          (m) => `
          <li class="match">
            <div class="match__meta">
              <span class="match__author">${escapeHtml(m.author)}</span>
              <span class="match__rating">${m.rating != null ? "&#9733;".repeat(Math.round(m.rating)) : ""}</span>
              <span class="match__date">${escapeHtml(m.date_label || "")}</span>
            </div>
            <p class="match__text">${escapeHtml(m.text)}</p>
          </li>`
        )
        .join("");

      li.innerHTML = `
        <details ${i === 0 && row.count > 0 ? "open" : ""}>
          <summary>
            <span class="rank-row__pos">${i + 1}</span>
            <span class="rank-row__name">${escapeHtml(row.label)}</span>
            <span class="rank-row__bar"><span style="width:${(row.count / maxCount) * 100}%"></span></span>
            <span class="rank-row__count">${row.count}</span>
          </summary>
          <ul class="matches">${reviewsHtml || '<li class="match match--none">No matching reviews in range.</li>'}</ul>
        </details>
      `;
      list.appendChild(li);
    });

    els.stores.appendChild(col);
  }
}

function setupControls() {
  els.dateFrom.addEventListener("change", render);
  els.dateTo.addEventListener("change", render);
  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.days);
      if (days === 0) {
        els.dateFrom.value = "";
        els.dateTo.value = "";
      } else {
        const to = new Date();
        const from = new Date(to.getTime() - days * 864e5);
        els.dateFrom.value = from.toISOString().slice(0, 10);
        els.dateTo.value = to.toISOString().slice(0, 10);
      }
      render();
    });
  });
}

setupControls();
loadAll();
