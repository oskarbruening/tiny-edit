import { describe, expect, it, vi } from "vitest";
import { OpenQueue } from "../../../src/main/openQueue";

describe("OpenQueue", () => {
  it("holds paths until a consumer attaches, then delivers them as one batch", () => {
    const q = new OpenQueue();
    q.push("/a.md");
    q.push("/b.md");
    const consumer = vi.fn();
    q.attach(consumer);
    expect(consumer).toHaveBeenCalledTimes(1);
    expect(consumer).toHaveBeenCalledWith(["/a.md", "/b.md"]);
  });

  it("delivers immediately once attached and does not call an attached consumer with nothing", () => {
    const q = new OpenQueue();
    const consumer = vi.fn();
    q.attach(consumer);
    expect(consumer).not.toHaveBeenCalled();
    q.push("/c.md");
    expect(consumer).toHaveBeenCalledWith(["/c.md"]);
  });
});
