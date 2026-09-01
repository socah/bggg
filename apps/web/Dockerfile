# syntax=docker/dockerfile:1

# --- deps: install only what apps/web needs, nothing from apps/api ---
FROM node:22-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=apps/web --include-workspace-root

# --- build: produce the traced 'standalone' server bundle ---
FROM node:22-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json /workspace/package-lock.json ./
COPY --from=deps /workspace/apps/web/package.json apps/web/package.json
# Copying the whole directory (rather than naming each source file) means
# a new top-level file (like auth.ts or tailwind.config.ts) is picked up
# automatically instead of causing a "Module not found" the next time
# something's added — .dockerignore already excludes node_modules/.next.
COPY apps/web apps/web
RUN npm run build --workspace=apps/web

# --- runtime: only the traced server + static assets, nothing else ---
FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
# Decision ('standalone' output, set in next.config.ts): Next's build
# already traces the minimal set of files this app needs — its own
# compiled code plus only the node_modules it actually imports — into
# .next/standalone. Copying that instead of a pruned full node_modules
# (apps/api's approach) matters more here because apps/web's tree pulls
# in React/Next.js's own considerable weight.
COPY --from=build /workspace/apps/web/.next/standalone ./
# Standalone tracing deliberately excludes static assets (CSS/JS chunks,
# images) — Next's docs assume you might serve those from a CDN instead.
# For this project they're served by the same container, so they're
# copied in alongside the traced server.
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /workspace/apps/web/public ./apps/web/public

# The base image bundles npm (and npx) for its own sake — this stage never
# runs either; CMD below calls 'node' directly, and the standalone output
# above already carries its own traced node_modules. That globally
# installed npm carries its own vendored 'tar' dependency, versioned
# independently of anything in this project's own package-lock.json
# (hence invisible to 'npm audit' and to the override in the root
# package.json), and it's the exact version Trivy flags as CRITICAL
# (CVE-2026-59873). Removing npm/npx here removes that CVE's only
# presence in this image, and costs nothing since nothing downstream of
# this line needs them.
RUN rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
ENV PORT=3000
# The standalone server binds to HOSTNAME (default 'localhost') — inside
# a container that only accepts loopback connections, meaning nothing
# outside the container (Traefik, another container) could ever reach it.
# 0.0.0.0 binds every interface instead.
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
