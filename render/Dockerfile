# PDF エンジン（Render の Web Service、Docker）。Cloudflare Browser Rendering と同じビルドの Chromium を Chrome for Testing から焼き込む。
# ビルドコンテキストはリポジトリのルート。Cloudflare の版が変わったら ARG CHROME を合わせて push（Render が自動で再ビルド）。
FROM node:22-bookworm-slim
ARG CHROME=128.0.6613.137
ENV CHROME_VERSION=${CHROME} PUPPETEER_CACHE_DIR=/opt/chrome NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fontconfig fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 \
    libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npx @puppeteer/browsers install chrome@${CHROME} --path /opt/chrome
COPY scripts/pdf-server.mjs ./scripts/
COPY src/fonts/*.ttf /usr/local/share/fonts/shuho/
RUN fc-cache -f
EXPOSE 10000
CMD ["node", "scripts/pdf-server.mjs"]
