# Dev-oriented Dockerfile — builds the whole workspace so pnpm workspace
# dependencies (@school/types, etc.) resolve correctly, then runs just the api.
FROM node:22-slim AS base
WORKDIR /repo
RUN corepack enable
# Prisma's query engine needs OpenSSL at runtime, not just in the build stage —
# node:22-slim doesn't ship it, and without it Prisma falls back to guessing
# openssl-1.1.x, which doesn't match this image's actual libssl.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

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
# @prisma/client's postinstall (in the `deps` stage) couldn't find prisma/schema.prisma
# yet — it isn't copied until this stage — so it generated an empty client. Regenerate
# now that the real schema is present. DATABASE_URL only needs to be well-formed here;
# `generate` never connects to it, it just needs env("DATABASE_URL") to resolve.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter=@school/api... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
