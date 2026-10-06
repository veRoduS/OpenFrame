import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Upload, X } from 'lucide-react';
import type { Asset } from './types';
import './media-uploads.css';

export type MediaUploadBatch = (
  files: File[],
  folderId?: string | null,
  shareWithSlideId?: string,
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
};

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
          await sendImage(
            file,
            folderId,
            shareWithSlideId,
            controller.signal,
            (progress, processing) =>
              update(index, {
                progress,
                status: processing ? 'processing' : 'uploading',
              }),
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
                          ? 'Processing image…'
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
