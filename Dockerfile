# Pinned on purpose: Bun has no LTS, so upgrades are deliberate. To upgrade, change this tag,
# rebuild, and run the tests in the new image (see "Upgrading Bun" in README.md).
FROM oven/bun:1.3.9-slim

WORKDIR /app

# Dependencies first, so code changes don't reinstall them. Production only: the bot needs
# no build step, and TypeScript is only used for type checking during development.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json bunfig.toml ./
COPY assets ./assets
COPY src ./src

# data/ (the database) and backups/ are bind-mounted by docker-compose, so they live on the
# host and survive rebuilds. The bot runs as the image's unprivileged "bun" user (uid 1000).
USER bun
CMD ["bun", "src/index.ts"]
