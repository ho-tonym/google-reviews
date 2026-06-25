// Minimal static file server for local development. Serves dist/ on :8080.
// Run `npm run build` first, then `npm run serve`.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");
const PORT = process.env.PORT || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let filePath = path.join(DIST, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`Serving dist/ at http://localhost:${PORT}`);
});
