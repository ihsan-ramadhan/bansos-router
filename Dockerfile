# bansos-router daemon container
# build:  docker build -t bansos-router .
# run:    export BANSOS_API_KEY="$(openssl rand -base64 32)"   # clients send this key
#         docker run -d --name bansos -p 17070:17070 -e BANSOS_API_KEY -v bansos-data:/home/bun/.bansos bansos-router

# stage 1: build the zero-dependency bundle (Bun is the only runtime)
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src/ src/
COPY scripts/build-cli.ts scripts/
COPY tsconfig.json vite.config.ts ./
RUN bun run build

# stage 2: minimal runtime (cli bundle + built ui, no dev deps)
FROM oven/bun:1.3-alpine
LABEL org.opencontainers.image.title="bansos-router"
LABEL org.opencontainers.image.description="Free keyless coding models routed through one local OpenAI/Anthropic endpoint"
LABEL org.opencontainers.image.source="https://github.com/ihsan-ramadhan/bansos-router"

WORKDIR /app
COPY package.json ./
# the whole dir: the guard entry (index.js) plus the split hashed chunk
COPY --from=build /app/dist/cli/ ./dist/cli/
COPY --from=build /app/dist/ui/ ./dist/ui/

# tini for correct SIGTERM forwarding to the foreground daemon. Run as the
# non-root `bun` user shipped by the image; its home is /home/bun, so ~/.bansos lives there.
RUN apk add --no-cache tini \
    && mkdir -p /home/bun/.bansos/logs \
    && chown -R bun:bun /home/bun/.bansos

USER bun

ENV NODE_ENV=production

EXPOSE 17070

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:17070/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# foreground daemon (no --bg inside a container; docker owns the lifecycle)
CMD ["bun", "dist/cli/index.js", "daemon", "--bind", "0.0.0.0"]
