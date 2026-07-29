FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV PORT=3000 \
    HOST=0.0.0.0 \
    CONFIG_PATH=/app/config.json \
    DB_PATH=/data/karaoke.db

EXPOSE 3000

CMD ["node", "src/index.js"]
