# Cached video support

## Using videos

In Media, choose **Video quality**, then upload an MP4, MOV, or WebM file. Economy
fits 720p and Quality fits 1080p, with portrait equivalents. Both preserve smaller
sources and frame rates below 30 fps. The upload notification separates transfer
from background processing. Finished videos appear with a poster, duration, and
optimized file size. Originals are discarded after conversion; keep your source
files separately if you may need to edit them later.

Choose **Add media** in the slide editor to insert a video. Each slide supports one
active video, with the same fit/crop controls as images. Editor and library cards
show still posters. Use playlist preview to watch playback. Videos are silent and
loop for the playlist item's duration. A single-item playlist continues looping;
playlist speed adjusts item duration, not the video's playback rate. Transitions
to or from video use Cut even if the playlist selects an animated transition.

Each player downloads the video and poster once, verifies them, and plays the local
copies. Network outages and offline restarts preserve the last fully downloaded
publication. Multiple players can play independently without repeated server
video transfers. Their playheads are not synchronized. A new version or a missing
or damaged cached file requires another download.

The shared renderer currently uses HTML video, including Android's WebView.
Media3/native playback remains a possible later alternative if the real Onn test
shows that it is needed. The desktop browser tests do not establish Onn hardware
decoding, thermals, or 24-hour reliability.

## Server operation

The Docker image includes FFmpeg and ffprobe. For local Node development, install
both tools on PATH with H.264 (`libx264`) encoding and WebP support. Image-only
operation does not require them. Input must contain one video track, have known
duration, and be no larger than 4096 pixels on either axis. HDR sources are
rejected; convert them to SDR first. Audio is removed, not merely muted.

Up to four uploads/queued/processing jobs share one conversion worker. FFmpeg uses
two codec threads and one filter thread, with a ten-minute encode timeout. The
quality setting uses a compression target and a peak-bitrate limit; output size
is checked independently. A high-motion clip that cannot fit the 25 MiB limit
must use Economy or be shortened. Conversion cannot guarantee identical quality
or a particular file size for every source.

Jobs are owned by their uploader, kept in memory for up to one hour (bounded to
128 recent jobs), and lost on server restart. Retry an unfinished upload after a
restart. Temporary files live under `DATA_DIR/video-work` and are cleaned on
completion, cancellation, failure, or next startup. Completed files live in
`DATA_DIR/media` and follow normal backup and access rules. Configure a reverse
proxy's upload limit to allow the source limit plus multipart overhead; its limit
can be lower than the application's. Uploading a file does not publish it.

## Implementation contract

The first implementation targets the existing Android WebView on the owner's Onn
1080p stick, with the shared browser renderer and Pi agent kept compatible. Real
device performance must be measured before claiming support. Playback is local
and independent on each screen; simultaneous playback is not synchronized.

- Upload videos through `POST /api/videos` (multipart `file`, optional `folderId`,
  `shareWithSlideId`, and `profile`: `economy` or `quality`). Return HTTP 202 with
  `{id, status}`. Poll `GET /api/video-jobs/:id` for `queued`, `processing`, `done`
  (with `asset`), or `error` (with `error`). `DELETE /api/video-jobs/:id` cancels a
  pending job. Jobs belong to their uploader. Image uploads remain `/api/assets`.
- Source limit: 100 MiB and 60 seconds. The server has one active encoder and a
  bounded queue. Uploads and conversion use temporary files, not whole-file RAM.
- Output: silent H.264 MP4, 8-bit 4:2:0, at most 30 fps, no upscaling. Economy fits
  1280 x 720 (portrait equivalent); quality fits 1920 x 1080. Each optimized file
  must fit 25 MiB. Audio is removed. Server-generated WebP posters are cached too.
- A video asset has the existing asset fields plus `kind: "video"`,
  `mime: "video/mp4"`, `durationMs`, `fps`, `profile`, and
  `poster: {filename, url, bytes, sha256, width, height}`. Legacy assets without
  `kind` remain images. Poster filenames are separate UUID `.webp` files.
- Published assets include both the video and its poster as a separate download
  entry (`id: video.id + "-poster"`, `kind: "image"`, plus poster fields). The
  video retains its nested poster metadata for rendering. URLs are same-origin
  `/media/<filename>` paths on server and player.
- Add layer type `video`, referencing `assetId` and using the existing image fit
  and crop fields. Limit each slide to one video. Editor thumbnails use posters;
  they must not autoplay a grid of videos. Video loops silently for the existing
  playlist item duration; a single-item playlist continues looping.
- Manifests containing video use schema 5. Ordinary publications retain their
  existing schema. Updated players accept schemas 1–5; older players reject 5
  and keep their last complete publication. Upgrade players before publishing
  video. Publication, sharing, deletion, and removed-media handling cover both
  images and videos, including poster sidecars.
- Prepare posters without opening another video decoder. Release outgoing video
  before activating incoming video. Use cuts for transitions involving video.
  Dispose media, listeners, and timers on cancellation, blanking, and background.
  Playback errors, five-second startup timeouts, or eight-second stalls show the
  poster, report an error in playback status, and allow the playlist to advance.
  A corrupt clip must not cause an endless preparation retry.
- Agents download to disk in bounded chunks, verify checksums, and commit only
  after all assets are present. Cache budget: 256 MiB including current and
  incoming publications. Never evict current assets to make an incomplete update
  fit. Clean obsolete files and failed partial files. Repeated playback reads
  local storage, not the content server.
- Android intercepted media and Pi loopback serving support MP4 MIME and HTTP
  byte ranges. Muted autoplay and lifecycle cleanup need browser/device tests.

## Acceptance

Automated coverage must exercise uploads and job ownership, failed conversion,
asset authorization, schema gating, publication/deletion, verified offline cache,
range requests, video lifecycle, and existing image playback. On the real Onn,
test both profiles, mixed slides, repeated loops, blank/resume, interrupted
downloads, offline restart, and a 24-hour run measuring memory and dropped frames.
No desktop test establishes hardware decoding or unattended device performance.
