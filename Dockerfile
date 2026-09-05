# bansos-router daemon container
# build:  docker build -t bansos-router .
# run:    docker run -d --name bansos -p 17070:17070 -v bansos-data:/root/.bansos bansos-router

# stage 1: build the zero-dependency bundle
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src/ src/
COPY tsconfig.json vite.config.ts ./
RUN npm run build

# stage 2: minimal runtime (cli bundle + built ui, no dev deps)
FROM node:22-alpine
LABEL org.opencontainers.image.title="bansos-router"
LABEL org.opencontainers.image.description="Free keyless coding models routed through one local OpenAI/Anthropic endpoint"
LABEL org.opencontainers.image.source="https://github.com/ihsan-ramadhan/bansos-router"

WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist/cli/index.js ./dist/cli/index.js
COPY --from=build /app/dist/ui/ ./dist/ui/

# tini for correct SIGTERM forwarding to the foreground daemon. C3: run as
# the non-root `node` user; its home is /home/node, so ~/.bansos lives there.
RUN apk add --no-cache tini \
    && mkdir -p /home/node/.bansos/logs \
    && chown -R node:node /home/node/.bansos

USER node

ENV NODE_ENV=production

EXPOSE 17070

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:17070/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# foreground daemon (no --bg inside a container; docker owns the lifecycle)
CMD ["node", "dist/cli/index.js", "daemon", "--bind", "0.0.0.0"]
