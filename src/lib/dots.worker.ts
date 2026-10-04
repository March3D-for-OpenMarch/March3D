import { parseDots, prepareDrillPositions } from "./dots";
import type { Drill } from "./dots";

type RequestMessage = {
  id: number;
  buffer: ArrayBuffer;
  sourceName: string;
  includeAudioData: boolean;
};

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, buffer, sourceName, includeAudioData } = event.data;

  try {
    const drill = await parseDots(buffer, sourceName, includeAudioData);
    const prepared = prepareDrillPositions(drill);
    const result: Drill = { ...drill, preparedPositions: prepared };

    self.postMessage({ id, ok: true, drill: result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not read .dots file.",
    });
  }
};
