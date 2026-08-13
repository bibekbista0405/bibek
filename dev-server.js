// dev-server.js
//
// A plain Node.js local dev server — no Vercel CLI involved at all.
// It serves index.html and runs the *exact same* api/contact.js handler
// that Vercel runs in production, so local testing is a faithful,
// dependency-free preview of the real thing. This exists because the
// Vercel CLI's zero-config detection has repeatedly tripped on this
// project's setup; this sidesteps that entirely for local development.
//
// Run with:  node dev-server.js   (or  npm run dev)
// Then open: http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");
const contactHandler = require("./api/contact.js");

// --- tiny .env loader (no extra dependency needed) ---
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const INDEX_HTML = path.join(__dirname, "index.html");

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  // --- API route: reuse the exact production handler ---
  if (url === "/api/contact") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      req.body = parsed;

      // Minimal Vercel-style res wrapper (status().json() chaining)
      const vercelRes = {
        _status: 200,
        status(code) {
          this._status = code;
          return this;
        },
        setHeader(k, v) {
          res.setHeader(k, v);
          return this;
        },
        json(obj) {
          sendJson(res, this._status, obj);
        },
        end(data) {
          res.writeHead(this._status);
          res.end(data);
        },
      };

      Promise.resolve(contactHandler(req, vercelRes)).catch((err) => {
        console.error("Handler error:", err);
        sendJson(res, 500, { success: false, error: "Unexpected server error." });
      });
    });
    return;
  }

  // --- Static file: this is a single-file portfolio, so just index.html ---
  if (url === "/" || url === "/index.html") {
    fs.readFile(INDEX_HTML, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("index.html not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  // --- Static files: serve any file that actually exists under the project
  //     root (e.g. /resume/Bibek-Bista-Resume.pdf), matching what Vercel's
  //     static output serves automatically in production. Guarded against
  //     path traversal.
  const decodedUrl = decodeURIComponent(url);
  if (
    decodedUrl.includes("/.") ||
    decodedUrl.startsWith("/api/") ||
    decodedUrl.startsWith("/node_modules/")
  ) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const requestedPath = path.normalize(path.join(__dirname, decodedUrl));
  if (!requestedPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(requestedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(requestedPath).toLowerCase();
    const types = {
      ".pdf": "application/pdf",
      ".html": "text/html; charset=utf-8",
      ".css": "text/css",
      ".js": "text/javascript",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Local dev server running → http://localhost:${PORT}\n`);
  if (
    !process.env.RESEND_API_KEY ||
    process.env.RESEND_API_KEY === "PASTE_YOUR_RESEND_API_KEY_HERE"
  ) {
    console.warn(
      "  ⚠️  RESEND_API_KEY is not set in .env yet — the Hire Me form will load, but sending will fail until you add your real key.\n"
    );
  }
});
