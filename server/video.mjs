import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';

export const VIDEO_SOURCE_LIMIT = 100 * 1024 * 1024;
export const VIDEO_OUTPUT_LIMIT = 25 * 1024 * 1024;
export const VIDEO_DURATION_LIMIT = 60;
const fail = (status, message) => Object.assign(new Error(message), { status });
const cancelled = () => fail(409, 'Video processing cancelled');

function command(binary, args, signal, timeout = 600000) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '',
      expired = false,
      excessive = false;
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      expired = true;
      abort();
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    child.stdout.on('data', (chunk) => {
      if (output.length + chunk.length > 256 * 1024) {
        excessive = true;
        abort();
      } else output += chunk.toString();
    });
    child.once('error', (error) => {
      cleanup();
      reject(
        fail(
          503,
          error.code === 'ENOENT'
            ? 'Video processing requires FFmpeg and ffprobe on the server'
            : 'The server could not start video processing',
        ),
      );
    });
    child.once('close', (code) => {
      cleanup();
      if (signal.aborted) reject(cancelled());
      else if (expired)
        reject(
          fail(
            422,
            'Video processing timed out; use a shorter or smaller source',
          ),
        );
      else if (code !== 0 || excessive)
        reject(
          fail(
            422,
            'Unable to process this video. Use a valid MP4, MOV, or WebM file',
          ),
        );
      else resolve(output);
    });
  });
}

export async function fileMetadata(filename) {
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(filename)) checksum.update(chunk);
  return { bytes: statSync(filename).size, sha256: checksum.digest('hex') };
}

function frameRate(value) {
  const [numerator, denominator = 1] = String(value).split('/').map(Number);
  return numerator / denominator;
}

async function probe(filename, signal) {
  const output = await command(
    'ffprobe',
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      'mov,matroska,webm',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,color_transfer',
      '-of',
      'json',
      filename,
    ],
    signal,
    30000,
  );
  try {
    return JSON.parse(output);
  } catch {
    throw fail(422, 'Unable to read video metadata');
  }
}

/** Expensive conversion happens once on the server, with two encoder threads. */
export async function processVideo({ source, directory, profile, signal }) {
  const metadata = await probe(source, signal);
  const videos =
    metadata.streams?.filter((stream) => stream.codec_type === 'video') || [];
  const stream = videos[0];
  const duration = Number(metadata.format?.duration);
  if (
    videos.length !== 1 ||
    !stream?.width ||
    !stream.height ||
    stream.width > 4096 ||
    stream.height > 4096 ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw fail(
      422,
      'Use a video with one video track, dimensions up to 4096 pixels, and a known duration',
    );
  if (duration > VIDEO_DURATION_LIMIT + 0.05)
    throw fail(422, 'Videos must be 60 seconds or shorter');
  if (['smpte2084', 'arib-std-b67'].includes(stream.color_transfer))
    throw fail(422, 'Convert HDR video to SDR before uploading');
  const sourceFps = frameRate(stream.avg_frame_rate);
  if (!Number.isFinite(sourceFps) || sourceFps <= 0)
    throw fail(422, 'The video has an unsupported frame rate');
  const fps = Math.min(30, sourceFps);
  const long = profile === 'quality' ? 1920 : 1280;
  const short = profile === 'quality' ? 1080 : 720;
  const videoPath = path.join(directory, 'playback.mp4');
  // Evaluate orientation after FFmpeg applies source rotation. Never upscale.
  const scale = `scale=w='min(iw,if(gte(iw,ih),${long},${short}))':h='min(ih,if(gte(iw,ih),${short},${long}))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=${fps},format=yuv420p`;
  await command(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-threads',
      '2',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file,pipe',
      '-format_whitelist',
      'mov,matroska,webm',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-vf',
      scale,
      '-c:v',
      'libx264',
      '-threads',
      '2',
      '-preset',
      'medium',
      '-profile:v',
      'main',
      '-level:v',
      profile === 'quality' ? '4.0' : '3.1',
      '-crf',
      '25',
      '-maxrate',
      profile === 'quality' ? '4M' : '2M',
      '-bufsize',
      profile === 'quality' ? '8M' : '4M',
      '-t',
      String(VIDEO_DURATION_LIMIT),
      '-fs',
      String(VIDEO_OUTPUT_LIMIT + 1),
      '-movflags',
      '+faststart',
      videoPath,
    ],
    signal,
  );
  const output = await probe(videoPath, signal);
  const encoded = output.streams?.find((item) => item.codec_type === 'video');
  const encodedDuration = Number(output.format?.duration);
  const video = await fileMetadata(videoPath);
  if (
    video.bytes > VIDEO_OUTPUT_LIMIT ||
    !encoded ||
    encoded.codec_name !== 'h264' ||
    encoded.pix_fmt !== 'yuv420p' ||
    !Number.isFinite(encodedDuration) ||
    encodedDuration <= 0 ||
    encodedDuration + 0.2 < duration
  )
    throw fail(
      422,
      'The optimized video exceeds the 25 MiB playback budget; use Economy or a shorter clip',
    );
  const posterPath = path.join(directory, 'poster.webp');
  await command(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-threads',
      '2',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      videoPath,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-vf',
      'scale=640:640:force_original_aspect_ratio=decrease',
      '-c:v',
      'libwebp',
      '-quality',
      '80',
      '-threads',
      '2',
      posterPath,
    ],
    signal,
    30000,
  );
  const posterInfo = await sharp(posterPath).metadata();
  return {
    videoPath,
    posterPath,
    ...video,
    width: encoded.width,
    height: encoded.height,
    durationMs: Math.round(encodedDuration * 1000),
    fps: frameRate(encoded.avg_frame_rate),
    poster: {
      ...(await fileMetadata(posterPath)),
      width: posterInfo.width,
      height: posterInfo.height,
    },
  };
}

/** Disk-backed uploads and one bounded background worker. Jobs are session-local. */
export function mountVideos({
  app,
  admin,
  root,
  context,
  validate,
  save,
  processor = processVideo,
}) {
  const directory = path.join(root, 'video-work');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Work files have no value after restart; completed assets live in media/.
  for (const entry of readdirSync(directory))
    if (/^[a-f0-9-]{36}$/.test(entry))
      rmSync(path.join(directory, entry), { recursive: true, force: true });
  const jobs = new Map();
  let running = false,
    closed = false;
  const active = (job) =>
    ['uploading', 'queued', 'processing'].includes(job.status);
  const discard = (job) =>
    rmSync(job.directory, { recursive: true, force: true });
  const visible = (job) => ({
    id: job.id,
    status: job.status,
    ...(job.asset ? { asset: job.asset } : {}),
    ...(job.error ? { error: job.error } : {}),
  });
  const prune = () => {
    for (const [id, job] of jobs)
      if (
        !active(job) &&
        (Date.now() - job.createdAt > 3600000 || jobs.size >= 128)
      )
        jobs.delete(id);
  };
  async function runNext() {
    if (running || closed) return;
    const job = [...jobs.values()].find((item) => item.status === 'queued');
    if (!job) return;
    running = true;
    job.status = 'processing';
    const written = [];
    try {
      const result = await processor({
        source: job.source,
        directory: job.directory,
        profile: job.profile,
        signal: job.controller.signal,
      });
      if (closed || job.controller.signal.aborted) throw cancelled();
      context.run(job.context, () => {
        // Recheck mutable user/folder/sharing permissions after queued work.
        const destination = validate(job.userId, job.fields);
        const id = randomUUID(),
          posterId = randomUUID();
        const filename = `${id}.mp4`,
          posterFilename = `${posterId}.webp`;
        for (const [source, name] of [
          [result.videoPath, filename],
          [result.posterPath, posterFilename],
        ]) {
          const target = path.join(root, 'media', name);
          renameSync(source, target);
          written.push(target);
        }
        job.asset = save(
          {
            id,
            filename,
            url: `/media/${filename}`,
            name: job.name,
            kind: 'video',
            mime: 'video/mp4',
            profile: job.profile,
            width: result.width,
            height: result.height,
            durationMs: result.durationMs,
            fps: result.fps,
            bytes: result.bytes,
            sha256: result.sha256,
            poster: {
              ...result.poster,
              filename: posterFilename,
              url: `/media/${posterFilename}`,
            },
            tags: [],
            folderId: destination.folderId,
            createdAt: new Date().toISOString(),
          },
          destination,
        );
      });
      job.status = 'done';
    } catch (error) {
      for (const file of written) rmSync(file, { force: true });
      job.status = 'error';
      job.error = error.status
        ? error.message
        : 'Video processing failed; try this file again';
    } finally {
      discard(job);
      // Avoid retaining request/account context after completion.
      delete job.context;
      running = false;
      void runNext();
    }
  }
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, done) => done(null, req.videoJob.directory),
      filename: (_req, _file, done) => done(null, 'source'),
    }),
    limits: {
      fileSize: VIDEO_SOURCE_LIMIT,
      files: 1,
      fields: 4,
      fieldSize: 1024,
    },
  }).single('file');
  app.post('/api/videos', admin, (req, res, next) => {
    prune();
    if (closed) return next(fail(503, 'Video processing is stopping'));
    if ([...jobs.values()].filter(active).length >= 4)
      return next(
        fail(
          429,
          'Video processing queue is full; try again after a clip finishes',
        ),
      );
    const id = randomUUID();
    const job = {
      id,
      userId: req.user.id,
      context: context.getStore(),
      directory: path.join(directory, id),
      status: 'uploading',
      createdAt: Date.now(),
      controller: new AbortController(),
    };
    jobs.set(id, job);
    mkdirSync(job.directory, { mode: 0o700 });
    req.videoJob = job;
    upload(req, res, (error) => {
      try {
        if (error) throw error;
        if (!req.file) throw fail(400, 'Choose an MP4, MOV, or WebM video');
        if (req.aborted) throw cancelled();
        job.fields = req.body;
        validate(job.userId, job.fields);
        job.profile = req.body.profile || 'economy';
        if (!['economy', 'quality'].includes(job.profile))
          throw fail(400, 'Choose Economy or Quality video optimization');
        job.name = req.file.originalname.slice(0, 200);
        job.source = req.file.path;
        job.status = 'queued';
        res.status(202).json(visible(job));
        void runNext();
      } catch (error) {
        jobs.delete(id);
        discard(job);
        next(error);
      }
    });
  });
  const find = (req) => {
    prune();
    const job = jobs.get(req.params.id);
    if (!job || job.userId !== req.user.id)
      throw fail(404, 'Video job not found; the server may have restarted');
    return job;
  };
  app.get('/api/video-jobs/:id', admin, (req, res) =>
    res.json(visible(find(req))),
  );
  app.delete('/api/video-jobs/:id', admin, (req, res) => {
    const job = find(req);
    if (job.status === 'done') return res.json(visible(job));
    job.controller.abort();
    const wasProcessing = job.status === 'processing';
    job.status = 'error';
    job.error = 'Video processing cancelled';
    if (!wasProcessing) discard(job);
    res.json(visible(job));
  });
  return {
    close() {
      closed = true;
      for (const job of jobs.values()) {
        job.controller.abort();
        if (job.status !== 'processing') discard(job);
      }
    },
  };
}
