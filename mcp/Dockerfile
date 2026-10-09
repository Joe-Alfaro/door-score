# Build context is the mcp/ directory. data/doors.json is the synced pipeline output
# (npm run sync-data copies ../data/out/doors.json when present, else keeps the committed copy).
#   docker build -t door-score-mcp .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY data ./data
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333
ENV DOORS_PATH=/app/data/doors.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
EXPOSE 3333
CMD ["node", "dist/server.js"]
