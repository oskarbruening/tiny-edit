import { CHANNELS } from "../shared/ipc";

export type FlushTarget = { id: number; send(channel: string, ...args: unknown[]): void };

/**
 * Asks a renderer to write its pending saves before the window closes and waits for the
 * ack, capped so a hung renderer can never block quitting. Words beat speed here, but a
 * frozen window must still close.
 */
export class FlushGate {
  private readonly pending = new Map<number, () => void>();

  constructor(private readonly timeoutMs = 2000) {}

  /** Called from the renderer:flushed IPC handler. */
  notify(senderId: number): void {
    const resolve = this.pending.get(senderId);
    if (resolve) {
      this.pending.delete(senderId);
      resolve();
    }
  }

  request(target: FlushTarget): Promise<"flushed" | "timeout"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(target.id);
        resolve("timeout");
      }, this.timeoutMs);
      this.pending.set(target.id, () => {
        clearTimeout(timer);
        resolve("flushed");
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
 * Intercepts the first close, flushes the renderer and the state store, then destroys the
 * window for real. Cmd+Q and the red button both arrive here.
 */
export function guardClose(win: ClosableWindow, gate: FlushGate, flushState: () => void): void {
  let done = false;
  win.on("close", (event) => {
    if (done) return;
    event.preventDefault();
    void gate.request(win.webContents).then(() => {
      flushState();
      done = true;
      win.destroy();
    });
  });
}
