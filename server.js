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
const COOKIES_PATH = process.env.YT_DLP_COOKIES_PATH || "";
const DEFAULT_OUTPUT_MODE = process.env.YT_DLP_OUTPUT_MODE || "compatible-mp4";
const DEBUG = process.env.DEBUG === "1";

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

function logDebug(message, details) {
  if (!DEBUG) {
    return;
  }

  console.log(message, details);
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(stderr.trim() || `${command} exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

app.post("/download", requireAuth, (req, res) => {
  const url = req.body?.url;
  const format = req.body?.format || DEFAULT_FORMAT;
  const filename = req.body?.filename || "video.mp4";
  const outputMode = req.body?.outputMode || DEFAULT_OUTPUT_MODE;

  logDebug("Starting download", { url, format, filename, outputMode });

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

    const tempCookiesPath = COOKIES_PATH ? path.join(tempDir, "cookies.txt") : "";
    if (COOKIES_PATH) {
      try {
        fs.copyFileSync(COOKIES_PATH, tempCookiesPath);
      } catch (copyError) {
        cleanupDir(tempDir);
        res.status(500).json({
          error: "Failed to prepare cookies file.",
          details: copyError.message
        });
        return;
      }
    }

    const outputTemplate = path.join(tempDir, "video.%(ext)s");
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--merge-output-format",
      "mp4",
      "--print",
      "after_move:filepath",
      "-f",
      format,
      "-o",
      outputTemplate,
      url
    ];

    if (tempCookiesPath) {
      args.splice(args.length - 1, 0, "--cookies", tempCookiesPath);
    }

    const child = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

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
        logDebug("yt-dlp exited with error", {
          url,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
        cleanupDir(tempDir);
        if (!res.headersSent) {
          res.status(502).json({
            error: "yt-dlp failed.",
            details: stderr.trim() || `yt-dlp exited with code ${code}`
          });
        }
        return;
      }

      fs.readdir(tempDir, async (readError, files) => {
        if (readError) {
          logDebug("Failed to inspect temp directory", {
            url,
            tempDir,
            error: readError.message
          });
          cleanupDir(tempDir);
          res.status(500).json({
            error: "Failed to inspect downloaded file.",
            details: readError.message
          });
          return;
        }

        const printedPath = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);

        logDebug("Temp directory contents", {
          url,
          tempDir,
          printedPath,
          files,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });

        const videoFile = files.find((file) => !file.endsWith(".part"));
        const videoPath = printedPath || (videoFile ? path.join(tempDir, videoFile) : "");

        if (!videoPath) {
          cleanupDir(tempDir);
          res.status(502).json({
            error: "yt-dlp returned no file."
          });
          return;
        }

        let finalVideoPath = videoPath;

        if (outputMode === "compatible-mp4") {
          const compatiblePath = path.join(tempDir, "video-compatible.mp4");

          try {
            await runProcess("ffmpeg", [
              "-y",
              "-i",
              videoPath,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-movflags",
              "+faststart",
              compatiblePath
            ]);
            finalVideoPath = compatiblePath;
          } catch (error) {
            logDebug("ffmpeg compatibility transcode failed", {
              url,
              videoPath,
              stderr: error.stderr || error.message
            });
            cleanupDir(tempDir);
            res.status(502).json({
              error: "Failed to convert video to compatible mp4.",
              details: error.stderr?.trim() || error.message
            });
            return;
          }
        }

        const stream = fs.createReadStream(finalVideoPath);

        res.status(200);
        res.setHeader("Content-Type", "video/mp4");
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
