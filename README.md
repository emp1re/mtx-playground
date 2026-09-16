

# MTX Playground

This repository contains code and examples for experimenting with MTX features and functionality.

## Getting Started

## Linux
Find device using the following command:

```bash

sudo apt install v4l-utils
v4l2-ctl --list-devices

Integrated Camera: Integrated C (usb-0000:02:00.0-4):
	/dev/video0
	/dev/video1
	/dev/media0


	!use /dev/video0!

```

use /dev/video0 for Linux video applications.


Find supported device resolution using the following command:

```bash
v4l2-ctl --list-formats-ext -d /dev/video0
```

```bash
ffmpeg \
  -f v4l2 \
  -input_format mjpeg \
  -video_size 1280x720 \
  -framerate 30 \
  -i /dev/video0 \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -pix_fmt yuv420p \
  -b:v 600k \
  -f rtsp \
  -rtsp_transport tcp \
  rtsp://localhost:8554/my_stream
```


## macOS: (needs testing)

Search video devices using the following command:

For macOS, you can use the `ffmpeg` command with the appropriate video device identifier obtained from the previous step.

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

Let's try streaming from the selected macOS video device using `ffmpeg`.

```bash
ffmpeg \
  -f avfoundation \
  -framerate 30 \
  -video_size 1280x720 \
  -i "0" \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -pix_fmt yuv420p \
  -b:v 600k \
  -f rtsp \
  -rtsp_transport tcp \
  rtsp://localhost:8554/my_stream
```


## Setup configration 

Use mediamtx docs for configuring the server.
https://mediamtx.org/docs/features/configuration

and see [config/mediamtx.yml](./config/mediamtx.yml) for an example configuration.


## Start docker container

```bash
docker build -t mediamtx-server .

docker run --rm -it \
  -v ./records:/recordings \
  -p 8554:8554 \
  mediamtx-server
```

-p 8554:8554 \ # rtsp
-p 1935:1935 \ # rtmp
-p 8888:8888 \ # http
-p 8889:8889 \ # https
-p 8892:8892 \ # websocket
-p 8890:8890/udp \ # websocket-udp
-p 8189:8189/udp \ # some-udp-service
-p 8892:8892/udp \ # some-udp-service
-p 8893:8893/udp \ # some-udp-service