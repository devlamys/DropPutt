# DropPutt API — production image.
#   docker build -t dropputt-api ./backend
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma's engines need OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Runtime dependencies only (the Prisma CLI is one: migrations run from this image).
RUN npm ci --omit=dev && npx prisma generate

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TZ=Asia/Kolkata
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini forwards SIGTERM so the API can shut down gracefully.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
