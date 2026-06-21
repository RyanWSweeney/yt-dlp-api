FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp
ENV YT_DLP_FORMAT=best[ext=mp4]/best

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3-minimal \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

COPY package.json ./

RUN npm install --omit=dev \
  && npm cache clean --force

COPY server.js ./

EXPOSE 3000

CMD ["npm", "start"]
