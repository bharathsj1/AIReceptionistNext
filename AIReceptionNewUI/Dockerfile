# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The API uses /api on the current origin. Only the video UI domain is public.
ARG VITE_JITSI_DOMAIN=meet.jit.si
ENV VITE_JITSI_DOMAIN=${VITE_JITSI_DOMAIN}
RUN npm run typecheck && npm run build

FROM nginx:stable-alpine AS runtime
ENV API_UPSTREAM=http://backend:80 \
    MEETINGS_UPSTREAM=http://meetings:80 \
    NGINX_ENVSUBST_FILTER=^(API_UPSTREAM|MEETINGS_UPSTREAM)$
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/api-proxy.conf /etc/nginx/snippets/api-proxy.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
