const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN || "";
const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
const DEFAULT_FORMAT = process.env.YT_DLP_FORMAT || "bestvideo*+bestaudio/best";

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

function cleanupDir(dirPath) {
  fs.rm(dirPath, { recursive: true, force: true }, () => {});
}

app.post("/download", requireAuth, (req, res) => {
  const url = req.body?.url;
  const format = req.body?.format || DEFAULT_FORMAT;
  const filename = req.body?.filename || "video.mp4";

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Body must include a string `url`." });
    return;
  }

  fs.mkdtemp(path.join(os.tmpdir(), "yt-dlp-api-"), (tempError, tempDir) => {
    if (tempError) {
      res.status(500).json({
        error: "Failed to create temp directory.",
        details: tempError.message
      });
      return;
    }

    const outputTemplate = path.join(tempDir, "video.%(ext)s");
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--merge-output-format",
      "mp4",
      "-f",
      format,
      "-o",
      outputTemplate,
      url
    ];

    const child = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    let finished = false;

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      cleanupDir(tempDir);
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
      finished = true;

      if (code !== 0) {
        cleanupDir(tempDir);
        if (!res.headersSent) {
          res.status(502).json({
            error: "yt-dlp failed.",
            details: stderr.trim() || `yt-dlp exited with code ${code}`
          });
        }
        return;
      }

      fs.readdir(tempDir, (readError, files) => {
        if (readError) {
          cleanupDir(tempDir);
          res.status(500).json({
            error: "Failed to inspect downloaded file.",
            details: readError.message
          });
          return;
        }

        const videoFile = files.find((file) => !file.endsWith(".part"));

        if (!videoFile) {
          cleanupDir(tempDir);
          res.status(502).json({
            error: "yt-dlp returned no file."
          });
          return;
        }

        const videoPath = path.join(tempDir, videoFile);
        const stream = fs.createReadStream(videoPath);

        res.status(200);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

        stream.on("error", (streamError) => {
          cleanupDir(tempDir);
          if (!res.headersSent) {
            res.status(500).json({
              error: "Failed to read downloaded file.",
              details: streamError.message
            });
            return;
          }

          res.destroy(streamError);
        });

        res.on("finish", () => {
          cleanupDir(tempDir);
        });

        res.on("close", () => {
          if (!res.writableEnded) {
            stream.destroy();
          }
          cleanupDir(tempDir);
        });

        stream.pipe(res);
      });
    });

    req.on("aborted", () => {
      if (!finished && !child.killed) {
        child.kill("SIGTERM");
      }
      cleanupDir(tempDir);
    });
  });
});

app.listen(PORT, () => {
  console.log(`yt-dlp binary API listening on port ${PORT}`);
});
