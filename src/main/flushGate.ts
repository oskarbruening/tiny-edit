import { CHANNELS } from "../shared/ipc";

export type FlushTarget = { id: number; send(channel: string, ...args: unknown[]): void };

/** The renderer answered: `pending` lists files whose edits could not be written (conflict, error). */
export type FlushOutcome = { status: "flushed"; pending: string[] } | { status: "timeout" };

/**
 * Asks a renderer to write its pending saves before the window closes and waits for the
 * ack, capped so a hung renderer can never block quitting on its own. Words beat speed here:
 * the caller decides what to do when something is still unsaved.
 */
export class FlushGate {
  private readonly pending = new Map<number, (pending: string[]) => void>();

  constructor(private readonly timeoutMs = 2000) {}

  /** Called from the renderer:flushed IPC handler. */
  notify(senderId: number, pending: readonly string[] = []): void {
    const resolve = this.pending.get(senderId);
    if (resolve) {
      this.pending.delete(senderId);
      resolve([...pending]);
    }
  }

  request(target: FlushTarget): Promise<FlushOutcome> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(target.id);
        resolve({ status: "timeout" });
      }, this.timeoutMs);
      this.pending.set(target.id, (pending) => {
        clearTimeout(timer);
        resolve({ status: "flushed", pending });
      });
      target.send(CHANNELS.rendererFlush);
    });
  }
}

export type ClosableWindow = {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  destroy(): void;
  webContents: FlushTarget;
};

/**
 * `null` when the renderer did not answer in time, otherwise the files still unsaved. Resolves
 * true to close anyway (discarding those edits), false to keep the window open.
 */
export type ConfirmDiscard = (unsaved: string[] | null) => Promise<boolean>;

/**
 * Intercepts the first close, flushes the renderer and the state store, then destroys the
 * window for real. Cmd+Q and the red button both arrive here. When edits remain unsaved the
 * user is asked before anything is discarded; cancelling keeps the window (and the quit) off.
 */
export function guardClose(
  win: ClosableWindow,
  gate: FlushGate,
  flushState: () => void,
  confirmDiscard: ConfirmDiscard = async () => true,
): void {
  let done = false;
  let closing = false;
  win.on("close", (event) => {
    if (done) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void gate.request(win.webContents).then(async (outcome) => {
      flushState();
      const unsaved = outcome.status === "timeout" ? null : outcome.pending;
      if ((unsaved === null || unsaved.length > 0) && !(await confirmDiscard(unsaved))) {
        closing = false;
        return;
      }
      done = true;
      win.destroy();
    });
  });
}
