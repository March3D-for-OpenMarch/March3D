import type { Drill } from "./dots";

type PendingRequest = {
  resolve: (drill: Drill) => void;
  reject: (error: Error) => void;
};

type WorkerResponse = {
  id: number;
  ok: boolean;
  drill?: Drill;
  error?: string;
};

const worker = new Worker(new URL("./dots.worker.ts", import.meta.url), {
  type: "module",
});

let nextId = 1;

const pending = new Map<number, PendingRequest>();

worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
  const request = pending.get(event.data.id);

  if (!request) {
    return;
  }

  pending.delete(event.data.id);

  if (event.data.ok && event.data.drill) {
    request.resolve(event.data.drill);
  } else {
    request.reject(new Error(event.data.error || "Could not read .dots file."));
  }
});

worker.addEventListener("error", (event) => {
  const error = new Error(
    event.message || "The .dots parser stopped unexpectedly.",
  );

  for (const request of pending.values()) {
    request.reject(error);
  }

  pending.clear();
});

export function parseDotsInWorker(
  buffer: ArrayBuffer,
  sourceName: string,
  includeAudioData = true,
): Promise<Drill> {
  const id = nextId++;

  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
    });

    worker.postMessage(
      {
        id,
        buffer,
        sourceName,
        includeAudioData,
      },
      [buffer],
    );
  });
}
