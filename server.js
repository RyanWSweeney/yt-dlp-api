const express = require("express");
const { spawn } = require("child_process");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN || "";
const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
const DEFAULT_FORMAT = process.env.YT_DLP_FORMAT || "best[ext=mp4]/best";

app.use(express.json({ limit: "1mb" }));

function requireAuth(req, res, next) {
  if (!API_TOKEN) {
    next();
    return;
  }

  const authHeader = req.get("authorization") || "";
  const expected = `Bearer ${API_TOKEN}`;

  if (authHeader !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/download", requireAuth, (req, res) => {
  const url = req.body?.url;
  const format = req.body?.format || DEFAULT_FORMAT;
  const filename = req.body?.filename || "video.mp4";

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Body must include a string `url`." });
    return;
  }

  const args = [
    "--no-playlist",
    "--no-warnings",
    "-f",
    format,
    "-o",
    "-",
    url
  ];

  const child = spawn(YT_DLP_PATH, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  let streamStarted = false;
  let clientGone = false;

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdout.once("data", () => {
    streamStarted = true;
    res.status(200);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  });

  child.stdout.pipe(res);

  child.on("error", (error) => {
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to start yt-dlp.",
        details: error.message
      });
      return;
    }

    res.destroy(error);
  });

  child.on("close", (code) => {
    if (code === 0) {
      if (!streamStarted && !res.headersSent) {
        res.status(502).json({
          error: "yt-dlp returned no data."
        });
      }
      return;
    }

    const message = stderr.trim() || `yt-dlp exited with code ${code}`;

    if (!streamStarted && !res.headersSent) {
      res.status(502).json({
        error: "yt-dlp failed.",
        details: message
      });
      return;
    }

    if (!clientGone) {
      res.destroy(new Error(message));
    }
  });

  res.on("close", () => {
    clientGone = !res.writableEnded;
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });
});

app.listen(PORT, () => {
  console.log(`yt-dlp binary API listening on port ${PORT}`);
});
