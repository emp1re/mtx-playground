#https://hub.docker.com/r/bluenviron/mediamtx/tags
# FROM bluenviron/mediamtx:1 AS mediamtx
FROM bluenviron/mediamtx:latest-ffmpeg AS mediamtx


# pick any Linux-based operating system you want.
FROM ubuntu:24.04

COPY --from=mediamtx /mediamtx /

#copy custom-mediamtx configuration if needed.
COPY config/mediamtx.yml /mediamtx.yml

# add anything you need.
# RUN apt update && apt install -y \
#    gstreamer1.0-tools

ENTRYPOINT [ "/mediamtx" ]