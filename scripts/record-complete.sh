#!/bin/sh
echo "Recording segment complete: $MTX_SEGMENT_PATH"
echo "Recording segment duration: $MTX_SEGMENT_DURATION"
echo "Recording path: $MTX_PATH"
echo "RTSP port: $RTSP_PORT"


sendWebhook() {
  url=$1
  payload=$2

  curl -sS --fail-with-body \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    "$url"
}
# 1. Generate the thumbnail path based on the segment path.

segment_path=${MTX_SEGMENT_PATH:?MTX_SEGMENT_PATH is required}
thumbnail_path="$(dirname "$segment_path")/thumnail.jpg"



# Create the directory for the thumbnail if it doesn't exist.
mkdir -p "$(dirname "$thumbnail_path")" || exit 1

if ! ffmpeg -hide_banner -loglevel error -nostdin -y \
  -ss 5 -i "$segment_path" \
  -map 0:v:0 -frames:v 1 -vf 'scale=640:-2' \
  -q:v 2 -update 1 "$thumbnail_path"; then
  echo "Thumbnail creation failed: $segment_path" >&2
  exit 1
fi

if [ -s "$thumbnail_path" ]; then
  echo "Thumbnail created: $thumbnail_path"
else
  echo "Thumbnail skipped: no video frame at 00:00:05 in $segment_path"
fi

# check recording status

session_id="$(basename "$(dirname "$segment_path")")"
target_dir="/opt/media/$session_id"

mkdir -p "$target_dir" || exit 1


dir="$(dirname "$segment_path")"

dir="${segment_path%/*}"

# Load the list of .mp4 files in the directory into positional parameters ($1, $2, $3, ...).
set -- "$dir"/*.mp4

# Manual emulation of "nullglob": if no files are found, sh will leave the "*.mp4" pattern as $1.
# Check if such a file physically exists.
if [ ! -e "$1" ]; then
  count=0
else
  count=$#
fi

dir="${segment_path%/*}"
set -- "$dir"/*.mp4

if [ ! -e "$1" ]; then
  count=0
else
  count=$#
fi

if [ "$count" -gt 1 ]; then
  list_file="$target_dir/concat-list.txt"
  : > "$list_file"

  for f in "$@"; do
    printf "file '%s'\n" "$f" >> "$list_file"
  done

  ffmpeg -hide_banner -loglevel error -nostdin -y \
    -f concat -safe 0 -i "$list_file" -c copy "$target_dir/video.mp4"
  
  sendWebhook "http://host.docker.internal:8008/clapi/hooks/video" "{\"status\":\"completed\",\"sid\":\"$session_id\"}"
  exit 0 # Without new thumbnail creation
else
  cp "$segment_path" "$target_dir/video.mp4"
  sendWebhook "http://host.docker.internal:8008/clapi/hooks/video" "{\"status\":\"completed\",\"sid\":\"$session_id\"}"
fi

cp "$thumbnail_path" "$target_dir/thumbnail.jpg"




