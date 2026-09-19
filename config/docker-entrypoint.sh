#!/bin/sh
# Docker entrypoint script to start NGINX and then mediamtx
set -eu

nginx

exec /mediamtx "$@"