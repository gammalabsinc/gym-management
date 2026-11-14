# Builds apps/api only, from the workspace root. The mobile app never enters the image.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/boundaries/package.json packages/boundaries/package.json
COPY packages/graphql-schema/package.json packages/graphql-schema/package.json
RUN pnpm install --frozen-lockfile --filter @gym/api...
COPY tsconfig.base.json ./
COPY packages/graphql-schema packages/graphql-schema
COPY apps/api apps/api
RUN pnpm --filter @gym/api run build \
 && pnpm --filter @gym/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production MODE=api PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
