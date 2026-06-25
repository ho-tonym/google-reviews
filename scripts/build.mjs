// Assembles the deployable site into dist/ by copying the static files in src/
// and the committed data/ JSON. If data/ has not been generated yet, seed it
// with empty placeholders so the page still renders.

import { cp, mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORES } from "./stores.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DATA = path.join(ROOT, "data");
const DIST = path.join(ROOT, "dist");
const DIST_DATA = path.join(DIST, "data");

async function seedDataIfMissing() {
  await mkdir(DATA, { recursive: true });
  const metaPath = path.join(DATA, "meta.json");
  if (!existsSync(metaPath)) {
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          generated_at: null,
          credits_remaining: null,
          stores: STORES.map((s) => ({
            id: s.id,
            label: s.label,
            address: s.address,
            rating: null,
            total_reviews: 0,
            review_count: 0,
          })),
        },
        null,
        2
      )
    );
  }
  for (const s of STORES) {
    const f = path.join(DATA, `${s.id}.json`);
    if (!existsSync(f)) {
      await writeFile(
        f,
        JSON.stringify(
          {
            store: { id: s.id, label: s.label, address: s.address, data_id: s.data_id, rating: null, total_reviews: 0 },
            fetched_at: null,
            reviews: [],
          },
          null,
          2
        )
      );
    }
  }
}

async function main() {
  await seedDataIfMissing();
  await mkdir(DIST, { recursive: true });
  await cp(SRC, DIST, { recursive: true });
  await mkdir(DIST_DATA, { recursive: true });
  await cp(DATA, DIST_DATA, { recursive: true });

  const files = await readdir(DIST);
  console.log(`Built dist/ with: ${files.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
