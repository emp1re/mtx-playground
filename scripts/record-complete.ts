/**
 * MediaMTX recording completion hook.
 *
 * MediaMTX starts this file every time a recording segment is finalized. It
 * passes information about that segment through environment variables:
 *
 * - MTX_SEGMENT_PATH: absolute path to the completed MP4 segment.
 * - MTX_SEGMENT_DURATION: duration of the completed segment.
 * - MTX_PATH: MediaMTX stream/path name, for example "cort_d".
 * - RTSP_PORT: port used by the MediaMTX RTSP server.
 *
 * The hook performs these operations in order:
 *
 * 1. Finds the session ID in the parent directory of MTX_SEGMENT_PATH.
 * 2. Creates /opt/media/<path>/<session-id>.
 * 3. Extracts a JPEG frame from the fifth second of the completed segment.
 * 4. Copies a single segment, or joins multiple segments, into video.mp4.
 * 5. Sends a JSON webhook only after the output files are ready.
 *
 * The default output root and webhook URL can be overridden with MEDIA_ROOT
 * and VIDEO_WEBHOOK_URL. These overrides are also useful for local tests.
 */

import { spawn } from "node:child_process";

import {
  copyFile,
  mkdir,
  readdir,
  stat,
  writeFile,
  rm,
} from "node:fs/promises";
import * as path from "node:path";

const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT ?? "/opt/media");
const WEBHOOK_URL =
  process.env.API_URL ??
  `${process.env.API_URL ?? "http://host.docker.internal:8008"}/clapi/hooks/video`;
const STATIC_URL = process.env.STATIC_URL ?? "http://localhost";
/**
 * Read a mandatory environment variable.
 *
 * `name: string` means that the argument must be a string. `: string` after
 * the closing parenthesis means that this function always returns a string.
 * Throwing here stops the hook early instead of working with an invalid path.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

/**
 * Start an external program and wait until it finishes.
 *
 * Node's `spawn()` is asynchronous. A Promise lets the caller use `await`, so
 * the next operation does not start before FFmpeg has finished. `stdio:
 * "inherit"` forwards FFmpeg output to the MediaMTX/Docker logs.
 */
function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.once("error", reject);
    child.once("exit", (code: number | null, signal: string | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} terminated by ${signal}`
            : `${command} exited with code ${code}`,
        ),
      );
    });
  });
}

/**
 * Return true only when the path points to a non-empty regular file.
 *
 * ENOENT means that the file does not exist and is an expected result here.
 * Every other filesystem error is rethrown because it may indicate a real
 * problem such as missing permissions.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

/**
 * Escape an apostrophe before writing a path into an FFmpeg concat file.
 */
function escapeConcatPath(filePath: string): string {
  return filePath.replaceAll("'", "'\\''");
}

/**
 * POST a JSON payload to the application webhook.
 *
 * `Record<string, unknown>` means an object with string keys whose values can
 * have any JSON-compatible type. `Promise<void>` means the function is
 * asynchronous and does not return a value. A non-2xx response is treated as
 * a failure and makes the hook exit with a non-zero status.
 */
async function sendWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Webhook failed: HTTP ${response.status}: ${body}`);
  }
}

/**
 * Execute the complete recording workflow.
 */
async function main(): Promise<void> {
  // MediaMTX writes segments to a path such as:
  // /tmp/cort_d/session-123/2026-09-17_15-45-11-376035.mp4
  const segmentPath = requiredEnv("MTX_SEGMENT_PATH");
  const mediaPath = requiredEnv("MTX_PATH");

  // The segment's parent directory represents the recording session. Its last
  // component becomes the session ID ("session-123" in the example above).
  const segmentDirectory = path.dirname(segmentPath);
  const sessionId = path.basename(segmentDirectory);

  // Final files are stored outside the temporary recording directory:
  // /opt/media/cort_d/session-123
  const targetDirectory = path.resolve(MEDIA_ROOT, mediaPath, sessionId);

  // Prevent a malformed MediaMTX path from escaping MEDIA_ROOT with "../".
  if (!targetDirectory.startsWith(`${MEDIA_ROOT}${path.sep}`)) {
    throw new Error(`Invalid output path: ${targetDirectory}`);
  }

  // "thumnail.jpg" intentionally keeps the filename requested by the API.
  const thumbnailPath = path.join(targetDirectory, "thumnail.jpg");
  const videoPath = path.join(targetDirectory, "video.mp4");
  const concatListPath = path.join(targetDirectory, "concat-list.txt");

  console.log("Recording segment complete:", segmentPath);
  console.log("Recording segment duration:", process.env.MTX_SEGMENT_DURATION ?? "");
  console.log("Recording path:", mediaPath);
  console.log("RTSP port:", process.env.RTSP_PORT ?? "");

  await mkdir(targetDirectory, { recursive: true });

  // Extract exactly one video frame at 00:00:05:
  // -ss 5          seek to the fifth second;
  // -map 0:v:0     use the first video stream;
  // -frames:v 1    produce a single image;
  // scale=640:-2   set width to 640 and preserve a valid aspect ratio;
  // -q:v 2         use high JPEG quality;
  // -update 1      write to one fixed filename instead of an image sequence.
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-ss",    "5",
    "-i",    segmentPath,
    "-map",    "0:v:0",
    "-frames:v",     "1",
    "-vf",  "scale=640:-2",
    "-q:v",     "2",
    "-update",    "1",
    thumbnailPath,
  ]);

  if (await fileExists(thumbnailPath)) {
    console.log("Thumbnail created:", thumbnailPath);
  } else {
    console.log(`Thumbnail skipped: no video frame at 00:00:05 in ${segmentPath}`);
  }

  // MediaMTX can produce multiple MP4 files for one session. Timestamp-based
  // filenames sort chronologically, so sorting also establishes concat order.
  const segmentFiles = (await readdir(segmentDirectory))
    .filter((fileName: string) => fileName.endsWith(".mp4"))
    .sort()
    .map((fileName: string) => path.join(segmentDirectory, fileName));

  if (segmentFiles.length === 0) {
    throw new Error(`No MP4 segments found in ${segmentDirectory}`);
  }

  if (segmentFiles.length === 1) {
    // No FFmpeg concatenation is necessary for a one-segment recording.
    await copyFile(segmentFiles[0], videoPath);
  } else {
    // The concat demuxer reads one input path per line. `-c copy` joins the
    // segments without re-encoding, which is fast and preserves video quality.
    const concatList = segmentFiles
      .map((filePath: string) => `file '${escapeConcatPath(filePath)}'`)
      .join("\n");

    await writeFile(concatListPath, `${concatList}\n`);
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",       "concat",
      "-safe",       "0",
      "-i",       concatListPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      videoPath,
    ]);

    if (!IsDevelopmentMode()) {
      await rm(concatListPath);
    }
  }

  // Notify the application only after video.mp4 has been successfully created.
  await sendWebhook(WEBHOOK_URL, {
    status: "completed",
    vid: sessionId,
    source_url: `${STATIC_URL}${videoPath}`,
    thumbnail_url: `${STATIC_URL}${thumbnailPath}`,
  });

  console.log("Video prepared:", videoPath);
  console.log("Webhook sent:", WEBHOOK_URL);
}

// An async function returns a Promise. Handle its rejection here so failures
// appear in Docker logs and MediaMTX receives a non-zero process exit status.
main().catch((error: unknown) => {
  console.error(
    "record-complete failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});


function IsDevelopmentMode(): boolean {
  return process.env.MODE === 'development';
}
