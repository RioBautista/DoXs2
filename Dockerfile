FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --workspaces --include-workspace-root=false
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run build -w @doxs/api && npm run build -w @doxs/shared
RUN npm prune --omit=dev --workspaces --include-workspace-root=false

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
