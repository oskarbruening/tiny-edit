/**
 * Paths handed to us by the OS (Finder double-click, Dock drop, `open -a`) can arrive
 * before the window exists. Queue them and drain once a consumer is ready.
 */
export class OpenQueue {
  private pending: string[] = [];
  private consumer: ((paths: string[]) => void) | null = null;

  push(path: string): void {
    if (this.consumer) this.consumer([path]);
    else this.pending.push(path);
  }

  /** From now on, deliver immediately; anything queued goes out right away. */
  attach(consumer: (paths: string[]) => void): void {
    this.consumer = consumer;
    if (this.pending.length) {
      const batch = this.pending;
      this.pending = [];
      consumer(batch);
    }
  }
}
