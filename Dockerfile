# JD Fit Check: production image for Cloud Run.
#
# Build:  docker build --build-arg NEXT_DEPLOYMENT_ID=<commit-sha> -t web .
# Run:    docker run -p 8080:8080 -e PORT=8080 \
#           -e NEXT_PUBLIC_SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e GEMINI_API_KEY=... web
#
# No NEXT_PUBLIC_* variable or secret is set while building. Next inlines any NEXT_PUBLIC_* value present at
# build time into server code too, so leaving it unset keeps the Supabase URL a runtime setting. The hosted
# service receives its keys from Secret Manager at runtime.

ARG NODE_IMAGE=node:26.2.0-bookworm-slim

# ---- build ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
# Read by `next build` natively: version-skew protection for clients that loaded an older deploy.
ARG NEXT_DEPLOYMENT_ID
ENV NEXT_DEPLOYMENT_ID=${NEXT_DEPLOYMENT_ID}
RUN npm run build

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# Poppler's pdftotext gives cleaner PDF text than the pdf2json fallback (see app/lib/documentExtraction.ts).
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 8080
CMD ["node", "server.js"]
