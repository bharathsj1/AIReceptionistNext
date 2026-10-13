# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public browser settings are compiled by Vite. Backend proxy target is runtime-only.
ARG VITE_JITSI_API_BASE=https://smartconnect4u-jitsi-eugahzaha5hcdefa.westeurope-01.azurewebsites.net/api
ARG VITE_JITSI_DOMAIN=meet.jit.si
ENV VITE_API_PROXY_BASE=/api
RUN npm run typecheck && npm run build

FROM nginx:stable-alpine AS runtime
ENV API_UPSTREAM=https://smartconnect4u-func.azurewebsites.net
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
