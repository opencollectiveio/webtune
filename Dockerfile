# Build dist/index.html from index.html + pitch.js, then prove the inlined DSP
# is still behaviourally identical to pitch.js by running the test suite against
# the shipped file. A failed build beats a tuner whose DSP drifted from source.
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN node build.mjs && node verify-inlined.mjs dist/index.html

# Runtime is nginx plus one HTML file — no Node, no dependencies.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
