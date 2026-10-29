# Build context is the mcp/ directory. No door data is baked in: the server loads the area a user
# drew in the map on demand (POST /mcp?territory=<id>) from the console API (API_BASE_URL).
#   docker build -t door-score-mcp .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3333
CMD ["node", "dist/server.js"]
