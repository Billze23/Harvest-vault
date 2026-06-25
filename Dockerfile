# Harvest Vault — Production Dockerfile
FROM node:20-bookworm-slim

# better-sqlite3 needs build tools to compile its native binding
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Data directory for SQLite — mount a volume here in EasyPanel
RUN mkdir -p /app/data /app/logs

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
