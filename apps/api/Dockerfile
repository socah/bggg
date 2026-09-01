# syntax=docker/dockerfile:1

# --- deps: install only what apps/api needs, nothing from apps/web ---
FROM node:22-alpine AS deps
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
FROM node:22-alpine AS build
WORKDIR /workspace
# Copy both the hoisted dependencies and the API workspace's local binaries.
# npm keeps some workspace devDependencies local, including the Nest CLI used
# during this build. Node's module resolution handles both locations.
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/api/node_modules ./apps/api/node_modules
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
FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/package.json apps/api/package.json

# The base image bundles npm (and npx) for its own sake — this stage never
# runs either; CMD below calls 'node' directly. That bundled npm carries
# its own vendored 'tar' dependency, versioned independently of anything
# in this project's own package-lock.json (hence invisible to 'npm audit'
# and to the override in the root package.json), and it's the exact
# version Trivy flags as CRITICAL (CVE-2026-59873). Removing npm/npx here
# removes that CVE's only presence in this image, and costs nothing since
# nothing downstream of this line needs them.
RUN rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Decision: create a non-root user now rather than leaving this as root
# and letting the 4_container_security topic retrofit it later — costs
# nothing to get right from the start, and that topic's job is to verify
# this checklist item, not introduce it from scratch.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
