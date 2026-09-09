FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --include-workspace-root=false
COPY backend backend
RUN npx prisma generate --schema backend/prisma/schema.prisma && npm run build -w backend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma
COPY scripts scripts
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/node_modules/@prisma /app/node_modules/@prisma
USER app
EXPOSE 3001
CMD ["node", "backend/dist/src/main.js"]
