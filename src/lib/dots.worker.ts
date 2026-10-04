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

    // The renderer only needs the compact prepared table. Keeping the raw
    // marcher_pages rows as well can make the Drill object enormous, and that
    // object is passed through React during a file switch. Drop the duplicate
    // raw positions once preparation is complete.
    const result: Drill = {
      ...drill,
      positions: [],
      preparedPositions: prepared,
    };

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
