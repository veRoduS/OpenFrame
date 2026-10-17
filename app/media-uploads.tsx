import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Upload, X } from 'lucide-react';
import type { Asset } from './types';
import './media-uploads.css';

export type MediaUploadBatch = (
  files: File[],
  folderId?: string | null,
  shareWithSlideId?: string,
  profile?: 'economy' | 'quality',
) => Promise<void>;
type Job = {
  name: string;
  bytes: number;
  progress: number;
  status:
    | 'queued'
    | 'uploading'
    | 'processing'
    | 'done'
    | 'error'
    | 'cancelled';
  error?: string;
  video?: boolean;
};

function isVideoFile(file: File) {
  return (
    file.type.startsWith('video/') || /\.(?:mp4|mov|webm)$/i.test(file.name)
  );
}

async function sendVideo(
  file: File,
  folderId: string | null,
  shareWithSlideId: string | undefined,
  profile: 'economy' | 'quality',
  signal: AbortSignal,
  progress: (value: number, processing?: boolean) => void,
): Promise<Asset> {
  const form = new FormData();
  form.append('file', file);
  if (folderId) form.append('folderId', folderId);
  if (shareWithSlideId) form.append('shareWithSlideId', shareWithSlideId);
  form.append('profile', profile);
  const response = await new Promise<{ id: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    if (signal.aborted)
      return reject(new DOMException('Upload cancelled', 'AbortError'));
    request.open('POST', '/api/videos');
    request.responseType = 'json';
    request.timeout = 180000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(event.loaded / event.total);
    };
    request.upload.onload = () => progress(1, true);
    request.onload = () => {
      const result = request.response;
      if (
        request.status !== 202 ||
        !result ||
        typeof result.id !== 'string' ||
        !result.id ||
        !['queued', 'processing'].includes(result.status)
      )
        reject(
          new Error(
            result?.error || `Video upload failed (HTTP ${request.status})`,
          ),
        );
      else resolve(result);
    };
    request.onerror = () =>
      reject(
        new Error('Connection lost. Check your connection and try again.'),
      );
    request.ontimeout = () =>
      reject(new Error('Upload timed out. Try this file again.'));
    request.onabort = () =>
      reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    request.onloadend = () => signal.removeEventListener('abort', abort);
    request.send(form);
  });
  let deleteSent = false;
  const cancel = () => {
    if (deleteSent) return;
    deleteSent = true;
    void fetch(`/api/video-jobs/${encodeURIComponent(response.id)}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => {});
  };
  if (signal.aborted) {
    cancel();
    throw new DOMException('Upload cancelled', 'AbortError');
  }
  signal.addEventListener('abort', cancel, { once: true });
  const deadline = Date.now() + 45 * 60 * 1000;
  try {
    while (!signal.aborted) {
      if (Date.now() >= deadline) {
        cancel();
        throw new Error(
          'Video processing took too long. The job was cancelled; try the upload again.',
        );
      }
      const pollController = new AbortController();
      const abortPoll = () => pollController.abort();
      signal.addEventListener('abort', abortPoll, { once: true });
      const pollTimeout = window.setTimeout(
        () => pollController.abort(),
        60000,
      );
      let job: Response;
      try {
        job = await fetch(
          `/api/video-jobs/${encodeURIComponent(response.id)}`,
          { signal: pollController.signal },
        );
      } catch {
        if (signal.aborted)
          throw new DOMException('Upload cancelled', 'AbortError');
        cancel();
        throw new Error(
          'Could not check video processing status. The job was cancelled; try the upload again.',
        );
      } finally {
        window.clearTimeout(pollTimeout);
        signal.removeEventListener('abort', abortPoll);
      }
      const result = await job.json();
      if (!job.ok)
        throw new Error(
          result?.error || 'Could not check video processing status',
        );
      if (
        !result ||
        result.id !== response.id ||
        typeof result.status !== 'string'
      )
        throw new Error('The server returned an invalid video job response');
      if (result.status === 'done') {
        if (
          !result.asset ||
          typeof result.asset.id !== 'string' ||
          result.asset.kind !== 'video' ||
          !result.asset.poster?.url
        )
          throw new Error(
            'The server returned an invalid processed video asset',
          );
        return result.asset as Asset;
      }
      if (result.status === 'error')
        throw new Error(result.error || 'Video processing failed');
      if (result.status !== 'queued' && result.status !== 'processing')
        throw new Error('The server returned an invalid video job status');
      progress(1, true);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          window.clearTimeout(timer);
          reject(new DOMException('Upload cancelled', 'AbortError'));
        };
        if (signal.aborted)
          return reject(new DOMException('Upload cancelled', 'AbortError'));
        const timer = window.setTimeout(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          Math.min(1000, deadline - Date.now()),
        );
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    throw new DOMException('Upload cancelled', 'AbortError');
  } finally {
    signal.removeEventListener('abort', cancel);
    if (signal.aborted) cancel();
  }
}

function sendImage(
  file: File,
  folderId: string | null,
  shareWithSlideId: string | undefined,
  signal: AbortSignal,
  progress: (value: number, processing?: boolean) => void,
): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let processing = false;
    const finish = (error?: Error, asset?: Asset) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(asset!);
    };
    const abort = () => {
      if (!processing || signal.reason === 'session-ended') request.abort();
    };
    if (signal.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    request.open('POST', '/api/assets');
    request.responseType = 'json';
    request.timeout = 180000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(event.loaded / event.total);
    };
    request.upload.onload = () => {
      processing = true;
      progress(1, true);
    };
    request.onload = () => {
      const result = request.response;
      if (request.status < 200 || request.status >= 300)
        finish(
          new Error(result?.error || `Upload failed (HTTP ${request.status})`),
        );
      else if (!result || typeof result.id !== 'string')
        finish(new Error('The server returned an invalid upload response'));
      else finish(undefined, result as Asset);
    };
    request.onerror = () =>
      finish(
        new Error('Connection lost. Check your connection and try again.'),
      );
    request.ontimeout = () =>
      finish(new Error('Upload timed out. Try this file again.'));
    request.onabort = () =>
      finish(new DOMException('Upload cancelled', 'AbortError'));
    const form = new FormData();
    form.append('file', file);
    if (folderId) form.append('folderId', folderId);
    if (shareWithSlideId) form.append('shareWithSlideId', shareWithSlideId);
    signal.addEventListener('abort', abort, { once: true });
    request.send(form);
  });
}

export function useMediaUploads(
  userId: string | null | undefined,
  refresh: () => Promise<void>,
) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [cancelRequested, setCancelRequested] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const stopUploads = useCallback(() => {
    generation.current++;
    active.current?.abort('session-ended');
    active.current = null;
  }, []);
  useEffect(() => {
    setJobs([]);
    setUploading(false);
    setRefreshError('');
    setCancelRequested(false);
    busy.current = false;
    return stopUploads;
  }, [userId, stopUploads]);

  const uploadBatch: MediaUploadBatch = async (
    files,
    folderId = null,
    shareWithSlideId,
    profile = 'economy',
  ) => {
    if (!files.length) return;
    if (!userId) throw new Error('Sign in to upload media');
    if (busy.current) throw new Error('Wait for the current uploads to finish');
    busy.current = true;
    const current = generation.current;
    const controller = new AbortController();
    active.current = controller;
    setUploading(true);
    setCancelRequested(false);
    setRefreshError('');
    setJobs(
      files.map((file) => ({
        name: file.name,
        bytes: Math.max(1, file.size),
        progress: 0,
        status: 'queued',
        video: isVideoFile(file),
      })),
    );
    const update = (index: number, patch: Partial<Job>) => {
      if (generation.current === current)
        setJobs((previous) =>
          previous.map((job, i) => (i === index ? { ...job, ...patch } : job)),
        );
    };
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (generation.current !== current) break;
        if (controller.signal.aborted) {
          update(index, { status: 'cancelled', progress: 1 });
          continue;
        }
        update(index, { status: 'uploading' });
        try {
          const report = (progress: number, processing?: boolean) =>
            update(index, {
              progress,
              status: processing ? 'processing' : 'uploading',
            });
          if (isVideoFile(file))
            await sendVideo(
              file,
              folderId,
              shareWithSlideId,
              profile,
              controller.signal,
              report,
            );
          else
            await sendImage(
              file,
              folderId,
              shareWithSlideId,
              controller.signal,
              report,
            );
          uploaded++;
          update(index, { status: 'done', progress: 1 });
        } catch (error) {
          update(index, {
            status:
              (error as Error).name === 'AbortError' ? 'cancelled' : 'error',
            progress: 1,
            error:
              (error as Error).name === 'AbortError'
                ? undefined
                : (error as Error).message,
          });
        }
      }
      if (uploaded && generation.current === current) {
        try {
          await refresh();
        } catch {
          if (generation.current === current)
            setRefreshError(
              'Uploads were saved, but the library could not refresh. Reload the page to see them.',
            );
        }
      }
    } finally {
      if (generation.current === current) {
        busy.current = false;
        active.current = null;
        setUploading(false);
      }
    }
  };
  const completed = jobs.filter((job) => job.status === 'done').length;
  const failed = jobs.filter((job) => job.status === 'error').length;
  const cancelled = jobs.filter((job) => job.status === 'cancelled').length;
  const totalBytes = jobs.reduce((sum, job) => sum + job.bytes, 0);
  const percent = totalBytes
    ? Math.round(
        (jobs.reduce((sum, job) => sum + job.bytes * job.progress, 0) /
          totalBytes) *
          100,
      )
    : 0;
  const title = uploading
    ? 'Uploading media'
    : failed
      ? 'Uploads finished with errors'
      : cancelled
        ? 'Uploads cancelled'
        : 'Upload complete';
  const announcement = `${title}. ${completed} of ${jobs.length} uploaded${failed ? `, ${failed} failed` : ''}${cancelled ? `, ${cancelled} cancelled` : ''}.`;
  const uploadNotice = jobs.length
    ? createPortal(
        <section className="media-upload-panel" aria-label="Media uploads">
          <header>
            {uploading ? (
              <Upload size={18} />
            ) : failed || cancelled ? (
              <CircleAlert size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <strong>{title}</strong>
            {!uploading && (
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss upload notification"
                onClick={() => setJobs([])}
              >
                <X size={18} />
              </button>
            )}
          </header>
          <output className="sr-only" aria-live="polite">
            {announcement}
          </output>
          <p>
            {completed} of {jobs.length} uploaded
            {failed ? ` · ${failed} failed` : ''}
            {cancelled ? ` · ${cancelled} cancelled` : ''}
          </p>
          <progress
            max={100}
            value={percent}
            aria-label="Overall upload progress"
          />
          <ul>
            {jobs.map((job, index) => (
              <li key={index} data-status={job.status}>
                <strong title={job.name}>{job.name}</strong>
                <span>
                  {job.status === 'done'
                    ? 'Uploaded'
                    : job.status === 'error'
                      ? 'Failed'
                      : job.status === 'cancelled'
                        ? 'Cancelled'
                        : job.status === 'processing'
                          ? job.video
                            ? 'Processing video…'
                            : 'Processing image…'
                          : job.status === 'queued'
                            ? 'Queued'
                            : `${Math.round(job.progress * 100)}%`}
                </span>
                {(job.status === 'uploading' ||
                  job.status === 'processing') && (
                  <progress
                    max={100}
                    value={Math.round(job.progress * 100)}
                    aria-label={`Upload progress for ${job.name}`}
                  />
                )}
                {job.error && <small>{job.error}</small>}
              </li>
            ))}
          </ul>
          {refreshError && <p className="inline-error">{refreshError}</p>}
          {uploading && (
            <button
              type="button"
              className="ghost"
              disabled={cancelRequested}
              onClick={() => {
                setCancelRequested(true);
                active.current?.abort('user-cancel');
              }}
            >
              {cancelRequested ? 'Finishing current upload…' : 'Cancel uploads'}
            </button>
          )}
        </section>,
        document.body,
      )
    : null;
  return { uploadBatch, uploading, uploadNotice };
}
