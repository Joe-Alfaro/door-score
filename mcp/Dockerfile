# Build from the repository root so the pipeline output can be baked into the image:
#   docker build -f mcp/Dockerfile -t door-score-mcp .
# (Railway: set the service's Dockerfile path to mcp/Dockerfile and leave the root directory at the repo root.)
FROM node:20-alpine AS build
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci
COPY mcp/tsconfig.json ./
COPY mcp/scripts ./scripts
COPY mcp/src ./src
# Pipeline output lands at ../data/out/doors.json relative to mcp/, exactly as in the repo.
COPY data/out/doors.json /app/data/out/doors.json
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333
ENV DOORS_PATH=/app/data/doors.json
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/mcp/dist ./dist
COPY --from=build /app/mcp/data ./data
EXPOSE 3333
CMD ["node", "dist/server.js"]
