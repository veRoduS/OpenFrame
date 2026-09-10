export function eligible(item, now) {
  return (
    item.scheduleEnabled === false ||
    ((!item.startsAt || Date.parse(item.startsAt) <= now) &&
      (!item.expiresAt || now < Date.parse(item.expiresAt)))
  );
}

/** One visible frame and one prepared frame; stale work never becomes visible. */
export class Playback {
  constructor({
    prepare,
    commit,
    report = () => {},
    now = () => performance.now(),
    wallNow = () => Date.now(),
    schedule = setTimeout,
    cancel = clearTimeout,
  }) {
    Object.assign(this, {
      prepare,
      commit,
      report,
      now,
      wallNow,
      schedule,
      cancel,
    });
    this.current = null;
    this.pending = null;
    this.timer = null;
    this.key = null;
    this.epoch = 0;
    this.missedDeadlines = 0;
    this.preparationMs = 0;
  }
  status(phase, error = null) {
    this.report({
      phase,
      error,
      slideId: this.current?.slideId || null,
      preparationMs: Math.round(this.preparationMs),
      missedDeadlines: this.missedDeadlines,
    });
  }
  clearPending() {
    this.cancel(this.timer);
    this.timer = null;
    if (this.pending) {
      this.pending.abort.abort();
      this.pending.frame?.dispose();
      this.pending = null;
    }
  }
  update(manifest, rotation = 0, generation = 0) {
    this.sourceManifest = manifest;
    this.generation = generation;
    this.cancel(this.windowTimer);
    this.windowTimer = null;
    const wall = this.wallNow();
    const indices = manifest.items.flatMap((item, index) =>
      eligible(item, wall) ? [index] : [],
    );
    const boundaries = manifest.items
      .filter((item) => item.scheduleEnabled !== false)
      .flatMap((item) => [item.startsAt, item.expiresAt])
      .filter(Boolean)
      .map(Date.parse);
    if (boundaries.length) {
      // Recheck wall-clock adjustments too; duration timers remain monotonic.
      const next = Math.min(
        1000,
        ...boundaries.filter((at) => at > wall).map((at) => at - wall),
      );
      this.windowTimer = this.schedule(
        () => this.update(manifest, rotation, generation),
        Math.max(1, next),
      );
    }
    const key = `${manifest.revision}:${rotation}:${generation}:${indices.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.epoch++;
    this.clearPending();
    this.manifest = {
      ...manifest,
      items: indices.map((index) => manifest.items[index]),
    };
    this.rotation = rotation;
    if (this.currentItem && !eligible(this.currentItem, wall)) {
      this.current?.dispose();
      this.current = null;
    }
    if (!this.manifest.items.length) {
      this.current?.dispose();
      this.current = null;
      this.status('empty');
      return;
    }
    this.stage(0, true);
  }
  stage(index, immediate) {
    const item = this.manifest.items[index],
      assets = this.manifest.assets,
      rotation = this.rotation;
    const slot = {
      index,
      immediate,
      epoch: this.epoch,
      abort: new AbortController(),
      frame: null,
      started: this.now(),
    };
    this.pending = slot;
    if (immediate) this.status('preparing');
    if (!immediate)
      this.timer = this.schedule(
        () => {
          this.timer = null;
          if (this.pending !== slot) return;
          if (slot.frame) this.show(slot);
          else {
            this.missedDeadlines++;
            this.status(
              'waiting',
              'Next slide is not ready; holding the current slide.',
            );
          }
        },
        Math.max(0, this.due - this.now()),
      );
    void Promise.resolve()
      .then(() => this.prepare(item, assets, rotation, slot.abort.signal))
      .then((frame) => {
        if (
          slot.abort.signal.aborted ||
          slot.epoch !== this.epoch ||
          this.pending !== slot
        ) {
          frame.dispose();
          return;
        }
        slot.frame = frame;
        this.preparationMs = this.now() - slot.started;
        if (immediate || this.now() >= this.due) this.show(slot);
        else this.status('playing');
      })
      .catch((error) => this.failed(slot, error));
  }
  failed(slot, error) {
    if (
      slot.abort.signal.aborted ||
      slot.epoch !== this.epoch ||
      this.pending !== slot
    )
      return;
    this.clearPending();
    this.status(
      'waiting',
      `Slide preparation failed: ${error.message || 'Unknown error'}`,
    );
    const epoch = this.epoch;
    this.timer = this.schedule(() => {
      if (epoch === this.epoch) this.stage(slot.index, slot.immediate);
    }, 2000);
  }
  show(slot) {
    if (slot !== this.pending || !slot.frame) return;
    if (!eligible(this.manifest.items[slot.index], this.wallNow())) {
      this.update(this.sourceManifest, this.rotation, this.generation);
      return;
    }
    try {
      this.commit(slot.frame, this.current);
    } catch (error) {
      this.failed(slot, error);
      return;
    }
    this.cancel(this.timer);
    this.timer = null;
    const previous = this.current;
    this.current = slot.frame;
    this.currentItem = this.manifest.items[slot.index];
    this.pending = null;
    previous?.dispose();
    this.due =
      this.now() + Math.max(2, this.manifest.items[slot.index].duration) * 1000;
    this.status('playing');
    if (this.manifest.items.length > 1)
      this.stage((slot.index + 1) % this.manifest.items.length, false);
  }
  stop(phase = 'empty') {
    this.cancel(this.windowTimer);
    this.windowTimer = null;
    this.epoch++;
    this.key = null;
    this.clearPending();
    this.current?.dispose();
    this.current = null;
    this.status(phase);
  }
}
