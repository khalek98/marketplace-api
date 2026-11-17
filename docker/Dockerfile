# Production image: build on node:22-slim, run on distroless (no shell).
# Build: npm run image:build  (needs .npm_token + BuildKit secret mount)

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmtoken \
    NPM_TOKEN="$(cat /run/secrets/npmtoken)" \
    && test -n "$NPM_TOKEN" \
    && npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmtoken \
    NPM_TOKEN="$(cat /run/secrets/npmtoken)" \
    && test -n "$NPM_TOKEN" \
    && npm ci --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi ./openapi
COPY package.json ./
USER nonroot
# ENTRYPOINT is already node — do not prefix with "node".
CMD ["dist/main.js"]
