# Dev-oriented Dockerfile — builds the whole workspace so pnpm workspace
# dependencies (@school/types, etc.) resolve correctly, then runs just the api.
FROM node:22-slim AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
RUN pnpm install --frozen-lockfile --filter=@school/api...

FROM deps AS build
COPY . .
RUN pnpm --filter=@school/api... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
