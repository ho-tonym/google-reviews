// Incrementally fetches Google reviews for each configured store via SerpAPI and
// writes one JSON file per store plus a meta.json (with remaining API credits).
//
// Usage: SERPAPI_KEY=xxx node scripts/fetch-reviews.mjs
//
// Strategy: reviews are fetched newest-first. On each run we load the reviews we
// already saved and stop paginating as soon as we encounter a review we have
// seen before, so a refresh with no new reviews costs ~1 credit per store.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORES } from "./stores.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const SERP_ENDPOINT = "https://serpapi.com/search.json";
const ACCOUNT_ENDPOINT = "https://serpapi.com/account.json";
const MAX_PAGES = 200; // hard safety cap (~4000 reviews) to avoid runaway loops
const REQUEST_DELAY_MS = 500; // pause between pages to ease SerpAPI/Google rate pressure
const REQUEST_TIMEOUT_MS = 30000; // abort a single SerpAPI call if it hangs this long

const API_KEY = process.env.SERPAPI_KEY;
if (!API_KEY) {
  console.error("Error: SERPAPI_KEY environment variable is not set.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SerpAPI occasionally returns a transient "couldn't get valid results" error or
// a 5xx; these usually succeed on retry. Retry such cases with backoff.
function isTransient(message, status) {
  if (status && status >= 500) return true;
  return /try again later|couldn't get valid results|timeout|timed out|temporarily|aborted|network|fetch failed/i.test(
    message || ""
  );
}

async function serp(params, { retries = 2, label = "request" } = {}) {
  const url = new URL(SERP_ENDPOINT);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("api_key", API_KEY);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal });
      const json = await res.json();
      if (json.error) {
        const willRetry = isTransient(json.error, res.status) && attempt < retries;
        console.warn(
          `  [SerpAPI] ${label}: error (attempt ${attempt + 1}/${retries + 1}): ${json.error}` +
            (willRetry ? ` - retrying...` : "")
        );
        if (willRetry) {
          lastErr = new Error(`SerpAPI error: ${json.error}`);
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw new Error(`SerpAPI error: ${json.error}`);
      }
      if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
      return json;
    } catch (err) {
      const msg = err.name === "AbortError" ? `request timed out after ${REQUEST_TIMEOUT_MS}ms` : err.message;
      lastErr = new Error(msg);
      const willRetry = attempt < retries && isTransient(msg);
      // Avoid double-logging the SerpAPI `error` field (already logged above).
      if (!/^SerpAPI error:/.test(msg)) {
        console.warn(
          `  [SerpAPI] ${label}: ${msg} (attempt ${attempt + 1}/${retries + 1})` +
            (willRetry ? ` - retrying...` : "")
        );
      }
      if (willRetry) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// Parses Google's relative dates ("3 months ago", "a week ago") into an
// approximate ISO timestamp, anchored on `now`. Only used when iso_date is absent.
function relativeToIso(label, now) {
  if (!label) return null;
  const m = label.toLowerCase().match(/(\d+|a|an)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return null;
  const qty = m[1] === "a" || m[1] === "an" ? 1 : parseInt(m[1], 10);
  const unitMs = {
    second: 1e3,
    minute: 6e4,
    hour: 36e5,
    day: 864e5,
    week: 6048e5,
    month: 2629746e3,
    year: 31556952e3,
  }[m[2]];
  return new Date(now.getTime() - qty * unitMs).toISOString();
}

function normalizeReview(rev, now) {
  return {
    id: rev.review_id ?? rev.link ?? `${rev.user?.name}-${rev.iso_date}`,
    author: rev.user?.name ?? "Anonymous",
    rating: typeof rev.rating === "number" ? rev.rating : null,
    text: rev.snippet ?? rev.extracted_snippet?.original ?? "",
    iso_date: rev.iso_date ?? relativeToIso(rev.date, now) ?? null,
    date_label: rev.date ?? "",
  };
}

async function loadExisting(storeId) {
  const file = path.join(DATA_DIR, `${storeId}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function resolveDataId(store, existing) {
  if (store.data_id) return store.data_id;
  if (existing?.store?.data_id) return existing.store.data_id;
  console.log(`  Resolving data_id for "${store.query}" ...`);
  const r = await serp(
    { engine: "google_maps", q: store.query, type: "search", hl: "en" },
    { label: `${store.label} data_id lookup` }
  );
  const dataId =
    r.place_results?.data_id ||
    (Array.isArray(r.local_results) && r.local_results[0]?.data_id);
  if (!dataId) throw new Error(`Could not resolve data_id for ${store.id}`);
  console.log(`  Resolved data_id=${dataId} (paste into scripts/stores.mjs to cache)`);
  return dataId;
}

async function fetchStore(store, now) {
  const existing = await loadExisting(store.id);
  const existingReviews = existing?.reviews ?? [];
  const knownIds = new Set(existingReviews.map((r) => r.id));
  const wasComplete = existing?.complete === true;
  const dataId = await resolveDataId(store, existing);

  // Mode:
  // - incremental: store already fully backfilled -> fetch newest, stop at first known review.
  // - resume backfill: previous run stopped partway -> continue from the saved token.
  // - full backfill: no prior data -> page through everything.
  const incremental = wasComplete;
  const resuming = !wasComplete && Boolean(existing?.resume_token);
  let token = resuming ? existing.resume_token : null;
  let resumeToken = existing?.resume_token ?? null;

  const fresh = [];
  let placeInfo = existing?.store ?? null;
  let complete = false;
  let failed = false;

  console.log(`  mode: ${incremental ? "incremental" : resuming ? "resume backfill" : "full backfill"}`);

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = { engine: "google_maps_reviews", data_id: dataId, sort_by: "newestFirst", hl: "en" };
      // `num` is only valid on paginated requests; the first page always returns 8.
      if (token) {
        params.next_page_token = token;
        params.num = 20;
      }
      const r = await serp(params, { label: `${store.label} page ${page + 1}` });
      if (r.place_info) placeInfo = r.place_info;

      const reviews = r.reviews ?? [];
      if (reviews.length === 0) {
        complete = true;
        resumeToken = null;
        break;
      }

      let hitKnown = false;
      for (const rev of reviews) {
        const norm = normalizeReview(rev, now);
        if (knownIds.has(norm.id)) {
          hitKnown = true;
          continue;
        }
        fresh.push(norm);
      }

      token = r.serpapi_pagination?.next_page_token ?? null;

      // Incremental fast path: once we reach reviews we already have, we're done.
      if (incremental && hitKnown) {
        complete = true;
        resumeToken = null;
        break;
      }
      if (!token) {
        complete = true;
        resumeToken = null;
        break;
      }
      // Successfully consumed this page; if the next one fails we resume here.
      resumeToken = token;
      if ((page + 1) % 5 === 0) {
        console.log(`  ${store.label}: ${page + 1} pages fetched, +${fresh.length} new so far`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  } catch (err) {
    failed = true;
    console.warn(`  ${store.label}: stopped early - ${err.message}`);
  }

  const merged = dedupeById([...existingReviews, ...fresh]).sort((a, b) =>
    (b.iso_date || "").localeCompare(a.iso_date || "")
  );

  const out = {
    store: {
      id: store.id,
      label: store.label,
      address: store.address,
      data_id: dataId,
      rating: placeInfo?.rating ?? null,
      total_reviews: placeInfo?.reviews ?? merged.length,
    },
    fetched_at: now.toISOString(),
    complete: complete && !failed,
    resume_token: complete && !failed ? null : resumeToken,
    reviews: merged,
  };

  await writeFile(path.join(DATA_DIR, `${store.id}.json`), JSON.stringify(out, null, 2));
  const status = out.complete ? "complete" : "partial (resumes next run)";
  console.log(`  ${store.label}: +${fresh.length} new, ${merged.length} total [${status}]`);
  return out;
}

function dedupeById(reviews) {
  const seen = new Set();
  const result = [];
  for (const r of reviews) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    result.push(r);
  }
  return result;
}

async function fetchCreditsRemaining() {
  try {
    const url = new URL(ACCOUNT_ENDPOINT);
    url.searchParams.set("api_key", API_KEY);
    const res = await fetch(url);
    const json = await res.json();
    return typeof json.total_searches_left === "number" ? json.total_searches_left : null;
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const now = new Date();

  const summaries = [];
  for (const store of STORES) {
    console.log(`Fetching ${store.label} ...`);
    const data = await fetchStore(store, now);
    summaries.push({
      id: data.store.id,
      label: data.store.label,
      address: data.store.address,
      rating: data.store.rating,
      total_reviews: data.store.total_reviews,
      review_count: data.reviews.length,
      complete: data.complete,
    });
  }

  const incomplete = summaries.filter((s) => !s.complete);
  if (incomplete.length > 0) {
    console.warn(
      `\n[!] ${incomplete.length} store(s) did NOT fully fetch (likely SerpAPI errors):`
    );
    for (const s of incomplete) {
      console.warn(`    - ${s.label}: ${s.review_count}/${s.total_reviews} reviews saved - re-run to resume.`);
    }
  } else {
    console.log("\nAll stores fully fetched.");
  }

  const credits = await fetchCreditsRemaining();
  const meta = {
    generated_at: now.toISOString(),
    credits_remaining: credits,
    stores: summaries,
  };
  await writeFile(path.join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`\nDone. Credits remaining: ${credits ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
