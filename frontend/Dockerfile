# DropPutt web — static React build served by Nginx, which also terminates
# TLS and proxies /api and /socket.io to the API. Build context = repo root:
#   docker build -f frontend/Dockerfile -t dropputt-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# No VITE_API_ORIGIN: the browser calls the same origin and Nginx proxies it.
RUN npm run build

FROM nginx:1.27-alpine
# The official image renders /etc/nginx/templates/*.template with the
# container's environment variables (DOMAIN) at start-up.
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
