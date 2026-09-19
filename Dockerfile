FROM bluenviron/mediamtx:1 AS mediamtx

FROM node:24-bookworm-slim

COPY --from=mediamtx /mediamtx /

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    ffmpeg 


ENTRYPOINT [ "/mediamtx" ]