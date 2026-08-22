# A container and a disk.
#
# The image holds the host and the Marble package; the drive is a volume. That
# split is the whole point of the card: nothing about a document depends on this
# image, so the container can be replaced under a running drive and the files
# are still files.
#
# Marble is a `file:` dependency in development and a published package in a
# build, so the image installs it by name. Point MARBLE_PACKAGE at a version, a
# tarball, or a git ref if you are running ahead of a release.

FROM node:22-alpine AS base
ARG MARBLE_PACKAGE=@bdhmin/marble@^0.1.2

WORKDIR /app

# Only what the host needs to run. The starters and the Drive template are
# source, not build output — there is no build step, which is the same reason a
# document has none.
COPY package.json ./
# The dependency is `file:../marble` in a checkout and a published package in an
# image, and the parent directory is not in the build context — so the entry is
# dropped before the real one is installed by name.
RUN npm pkg delete dependencies.@bdhmin/marble \
 && npm install --omit=dev --no-audit --no-fund "$MARBLE_PACKAGE" \
 && npm cache clean --force

COPY bin ./bin
COPY server ./server
COPY runtime ./runtime
COPY lib ./lib
COPY starters ./starters
COPY templates ./templates

# The drive lives on a volume. If this path is not mounted, the documents live
# in the container and go away with it — which is the one failure mode worth
# spelling out in a comment nobody reads until it happens.
ENV MARBLE_DRIVE_ROOT=/data \
    PORT=4400 \
    HOST=0.0.0.0 \
    NODE_ENV=production
# Made and owned before the volume is declared: Docker seeds a named volume from
# the image, ownership included, and a drive root the process cannot write to is
# a host that starts cleanly and fails on the first document.
RUN mkdir -p /data /backups && chown -R node:node /data /backups
VOLUME ["/data"]
EXPOSE 4400

# Answers before the gate does, so a health check needs no secret.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4400)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "bin/marble-drive.js", "serve"]
