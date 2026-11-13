# Verynize collaboration server on Node (docs/self-hosting.md). Build: docker build -t verynize-server .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped: the server needs neither Electron, node-pty nor workerd.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build:ui

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY cloud ./cloud
# From the build stage: integrations/generated/ is emitted from integrations/src by build:ui.
COPY --from=build /app/integrations ./integrations
COPY server ./server
COPY --from=build /app/web ./web
RUN rm -rf web/src && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "server/node.mjs"]
