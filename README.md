# Vive La Crepe - Review Name Rankings

A static site (served on GitHub Pages) that ranks Google reviews by how often tracked
names are mentioned, across three Vive La Crepe NYC locations:

- **Columbus Ave** - 532 Columbus Ave, New York, NY 10023
- **Hudson Yards** - 20 Hudson Yards 4th floor, New York, NY 10001
- **Lexington Ave** - 958 Lexington Ave #958B, New York, NY 10021

Each store gets its own column with an average rating, total/in-range review counts,
a date filter, and a descending ranking of tracked name groups. A badge in the top-right
shows remaining SerpAPI credits as of the last refresh.

## How it works

```
workflow_dispatch -> fetch-reviews.mjs (SerpAPI, incremental) -> commit data/*.json -> build dist/ -> deploy to Pages
```

- Reviews are fetched **newest-first**. Each run loads the reviews already saved in
  `data/` and stops paginating as soon as it hits a review it has seen before, so a
  refresh with no new reviews costs about 1 SerpAPI credit per store.
- The first run does a full backfill (~29 credits for all three stores).
- Name matching is **whole-word, case-insensitive**, with nickname grouping: a review
  counts once per group if it mentions any alias (e.g. `Sam / Sammy / Samantha`).

## One-time setup

1. **Create a GitHub repo** and push this project to it.
2. **Get a free SerpAPI key** at <https://serpapi.com> (250 searches/month free).
3. In the repo, go to **Settings -> Secrets and variables -> Actions** and add a secret:
   - Name: `SERPAPI_KEY`
   - Value: your SerpAPI key
4. Go to **Settings -> Pages** and set **Source = GitHub Actions**.
5. Go to the **Actions** tab, select **"Refresh reviews and deploy"**, and click
   **Run workflow**. The first run backfills all reviews, commits them to `data/`,
   and deploys the site.

The site URL appears in the workflow's deploy step (and under Settings -> Pages).

## Refreshing data

Trigger **Actions -> Refresh reviews and deploy -> Run workflow** whenever you want
fresh data. There is no schedule, so credits are only spent when you ask for it.

## Customizing

- **Tracked names / nicknames:** edit `TRACKED_GROUPS` in [`src/app.js`](src/app.js).
  Each entry is `{ aliases: [...] }`; the ranking row label is the aliases joined with ` / `.
- **Stores:** edit [`scripts/stores.mjs`](scripts/stores.mjs). `data_id` is resolved
  automatically on first run and cached into each store's JSON; you can paste it back
  into `stores.mjs` to be explicit.

## Local development

```bash
npm run fetch    # requires SERPAPI_KEY in your environment (spends credits)
npm run build    # assemble dist/ (seeds empty data/ if you haven't fetched yet)
npm run serve    # serve dist/ at http://localhost:8080
```

To preview the layout without spending credits, just run `npm run build && npm run serve` -
the page renders with empty rankings until real data is fetched.

## Resuming / partial fetches

`fetch-reviews.mjs` is resilient to SerpAPI hiccups:

- Reviews are fetched newest-first. Each successful page is saved, and the script
  records a `resume_token` plus a `complete: false` flag if it could not finish a store.
- Re-running `npm run fetch` (or the workflow) **resumes** each unfinished store from
  where it left off, instead of starting over - so progress and credits are never lost.
- Once a store is fully backfilled (`complete: true`), later runs switch to the cheap
  incremental mode (newest-first, stop at the first already-saved review).

Note: SerpAPI's Google-reviews pagination occasionally returns "We couldn't get valid
results for this search. Please try again later." for ALL places (page 1 works, deeper
pages fail). When that happens, only the newest 8 reviews per store are saved and the
stores stay `complete: false`. Just re-run later - the resume logic backfills the rest
once SerpAPI's pagination recovers, with no wasted credits.

## Notes & limitations

- Review counts shown are Google's reported totals; exact figures (and credit usage)
  vary as reviews change.
- Older reviews sometimes only have relative dates ("3 months ago"); these are converted
  to approximate ISO dates, so date filtering is approximate for older entries.
- Scraping Google reviews via third-party APIs may be subject to Google's terms; use at
  your own discretion.
