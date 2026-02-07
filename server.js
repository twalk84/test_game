const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const requestedPort = Number(process.argv[2] || process.env.PORT || 8080);
const PORT = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function resolveSafePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, "");
  const relativePath = normalized.replace(/^[/\\]+/, "");
  const candidate = relativePath === "" ? "index.html" : relativePath;
  const fullPath = path.join(ROOT, candidate);

  if (!fullPath.startsWith(ROOT)) {
    return null;
  }
  return fullPath;
}

const server = http.createServer((req, res) => {
  const fullPath = resolveSafePath(req.url || "/");
  if (!fullPath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(fullPath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(fullPath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
        return;
      }

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Game server running at http://${HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use on ${HOST}.`);
    console.error(`Either stop the existing server, or run: node .\\server.js ${PORT + 1}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
