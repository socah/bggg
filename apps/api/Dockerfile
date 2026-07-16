# syntax=docker/dockerfile:1

# --- deps: install only what apps/api needs, nothing from apps/web ---
FROM node:20-alpine AS deps
WORKDIR /workspace
# 'workspaces' in the root package.json is a glob ("apps/*") — npm
# resolves it against whatever package.json files actually exist in this
# build context, not against what's declared. Only copying apps/api's
# means apps/web's dependency tree (React, Next.js, ...) never enters
# this image at all.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=apps/api --include-workspace-root

# --- build: compile TypeScript to dist/, then strip dev-only deps ---
FROM node:20-alpine AS build
WORKDIR /workspace
# No 'apps/api/node_modules' to copy here — with only this one workspace
# in the build context, every dependency hoists cleanly to the root
# node_modules (no version conflict forcing a nested copy, unlike the full
# monorepo install on a dev machine). Node's own module resolution walks
# up from apps/api/ and finds packages here regardless.
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json /workspace/package-lock.json ./
COPY --from=deps /workspace/apps/api/package.json apps/api/package.json
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY tsconfig.json ./
RUN npm run build --workspace=apps/api
# @nestjs/cli, jest, ts-node etc. were only needed to reach this point.
# Pruning here means the runtime stage copies an already dev-free
# node_modules instead of running a second install from scratch.
RUN npm prune --omit=dev --workspace=apps/api --include-workspace-root

# --- runtime: only compiled JS + production node_modules ---
FROM node:20-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/package.json apps/api/package.json

# Decision: create a non-root user now rather than leaving this as root
# and letting the 4_container_security topic retrofit it later — costs
# nothing to get right from the start, and that topic's job is to verify
# this checklist item, not introduce it from scratch.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
