# yt-dlp Binary API

Minimal Express API for a droplet or VPS that lets n8n call `yt-dlp` and receive the video bytes directly in the HTTP response.

## What it does

- `GET /health` returns a simple health response
- `POST /download` accepts a video URL and streams the result back as raw binary
- Optional bearer token auth through `API_TOKEN`

This app does not save the video to disk. It pipes `yt-dlp` stdout straight to the HTTP response.

## Requirements

- For Docker: Docker Engine with Compose
- For local non-Docker runs: Node.js 18+, `yt-dlp`, and ideally `ffmpeg`

## Install

```bash
npm install
```

## Docker Deploy

This repo includes a stripped-down container so you can deploy it on a droplet with a few commands.

### Files included

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`

### Droplet setup

```bash
git clone <your-repo-url>
cd <your-repo-folder>
cp .env.example .env
```

Edit `.env` and set a real `API_TOKEN`.

Then build and start:

```bash
docker compose build
docker compose up -d
```

Check logs:

```bash
docker compose logs -f
```

Stop it:

```bash
docker compose down
```

### Compose behavior

- App listens on container port `3000`
- Host port is controlled by `PORT` in `.env`
- Container includes both `ffmpeg` and the latest `yt-dlp` binary
- Restart policy is `unless-stopped`

## Run

```bash
API_TOKEN=your-secret-token PORT=3000 npm start
```

If `yt-dlp` is not on your `PATH`, set:

```bash
YT_DLP_PATH=/full/path/to/yt-dlp
```

Optional default format override:

```bash
YT_DLP_FORMAT='best[ext=mp4]/best'
```

## API

### Health

```http
GET /health
```

### Download

```http
POST /download
Content-Type: application/json
Authorization: Bearer your-secret-token

{
  "url": "https://www.youtube.com/watch?v=...",
  "filename": "video.mp4",
  "format": "best[ext=mp4]/best"
}
```

### Response

- `200 OK`
- `Content-Type: application/octet-stream`
- Body is the raw video binary stream

## n8n Notes

In n8n, use an HTTP Request node:

- Method: `POST`
- URL: `http://your-server:3000/download`
- Send body as JSON
- Set response format to file/binary
- If using auth, add `Authorization: Bearer your-secret-token`

Example body:

```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "filename": "video.mp4"
}
```

## Example curl

```bash
curl -X POST http://localhost:3000/download \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your-secret-token' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","filename":"video.mp4"}' \
  --output video.mp4
```
