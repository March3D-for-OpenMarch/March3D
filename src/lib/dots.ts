import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export type Marcher = {
  id: number;
  name: string | null;
  section: string;
  drillPrefix: string;
  drillOrder: number;
};
export type Position = {
  marcherId: number;
  pageId: number;
  x: number;
  y: number;
  rotation: number;
  fillColor?: string | null;
  visible: boolean;
  labelVisible: boolean;
};
export type Page = {
  id: number;
  index: number;
  displayNumber: number;
  startBeat: number;
  startBeatIndex: number;
  notes?: string;
};
export type Beat = { id: number; duration: number; position: number };
export type Field = {
  name: string;
  stepSizeInches: number;
  width: number;
  height: number;
  yardNumberCoordinates?: {
    homeStepsFromFrontToOutside: number;
    homeStepsFromFrontToInside: number;
    awayStepsFromFrontToInside: number;
    awayStepsFromFrontToOutside: number;
  };
  centerFrontPoint?: { xPixels: number; yPixels: number };
  xCheckpoints?: Array<{
    stepsFromCenterFront: number;
    name: string;
    terseName: string;
  }>;
  yCheckpoints?: Array<{
    stepsFromCenterFront: number;
    name: string;
    terseName: string;
  }>;
};
export type SectionAppearance = {
  section: string;
  fillColor: string | null;
  shapeType: string | null;
};

export type AudioTrack = {
  id: number;
  path: string;
  nickname: string | null;
  selected: boolean;
  data: Uint8Array;
};

export type PreparedPosition = {
  x: number;
  z: number;
  rotation: number;
  visible: boolean;
  color: string;
};

export type March3DInstruction = {
  pageIndex: number;
  count: number;
  target: string;
  action: "horn" | "facing" | "marching" | "equipment" | "guardMotion";
  value:
    | "up"
    | "down"
    | "backfield"
    | "frontfield"
    | "doubleTime"
    | "fullTime"
    | "markTime"
    | "none"
    | "has"
    | "flag"
    | "rifle"
    | "saber"
    | "spinning"
    | "tossing";
  durationCounts?: number;
  shoulder?: "right" | "left";
};

/** Extract only the dedicated instruction block; never interpret ordinary notes. */
export function parseMarch3DInstructions(
  notes: string,
  pageIndex: number,
): March3DInstruction[] {
  const lines = notes
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const result: March3DInstruction[] = [];
  let inside = false;
  for (const line of lines) {
    if (/^March3D Instructions\s*:/i.test(line)) {
      inside = true;
      continue;
    }
    if (!inside || !line) continue;
    const match =
      /^(?:Count\s+(\d+)\s+)?(.+?)\s+(Horns?\s+(?:Up|Down)|Face\s+(?:Backfield|Frontfield)|Double\s+Time|Full\s+Time|Double|Mark\s+Time|No\s+Equipment|Has\s+Equipment|Switch\s+To\s+(?:Riffle|Rifle|Saber|Sabre|Flag)|Spinning|Spining|Tossing)(?:\s+For\s+(\d+)\s+Counts?(?:\s+over\s+(right|left))?)?\s*$/i.exec(
        line,
      );
    if (!match) continue;
    const count = match[1] ? Number(match[1]) : 1;
    if (!Number.isSafeInteger(count) || count < 1) continue;
    const phrase = match[3].toLowerCase().replace(/\s+/g, " ");
    let action: March3DInstruction["action"];
    let value: March3DInstruction["value"];
    if (phrase.startsWith("horn")) {
      action = "horn";
      value = phrase.endsWith("down") ? "down" : "up";
    } else if (phrase.startsWith("face")) {
      action = "facing";
      value = phrase.endsWith("backfield") ? "backfield" : "frontfield";
    } else if (phrase === "double time" || phrase === "double") {
      action = "marching";
      value = "doubleTime";
    } else if (phrase === "full time") {
      action = "marching";
      value = "fullTime";
    } else if (phrase === "mark time") {
      action = "marching";
      value = "markTime";
    } else if (phrase === "no equipment" || phrase === "has equipment") {
      action = "equipment";
      value = phrase === "no equipment" ? "none" : "has";
    } else if (phrase.startsWith("switch to ")) {
      action = "equipment";
      value = /rifle|riffle/.test(phrase)
        ? "rifle"
        : /saber|sabre/.test(phrase)
          ? "saber"
          : "flag";
    } else {
      action = "guardMotion";
      value = phrase === "tossing" ? "tossing" : "spinning";
    }
    const durationCounts = match[4] ? Number(match[4]) : 1;
    if (!Number.isSafeInteger(durationCounts) || durationCounts < 1) continue;
    const shoulder = match[5]?.toLowerCase() as "right" | "left" | undefined;
    result.push({
      pageIndex,
      count,
      target: match[2].trim(),
      action,
      value,
      durationCounts,
      shoulder,
    });
  }
  return result;
}

export type Drill = {
  audio?: AudioTrack | null;
  audioOffsetSeconds: number;
  lastPageCounts: number;
  marchers: Marcher[];
  pages: Page[];
  instructions?: March3DInstruction[];
  beats: Beat[];
  positions: Position[];
  field: Field;
  appearances: SectionAppearance[];
  sourceName: string;
  preparedPositions?: Array<Array<PreparedPosition | undefined>>;
};

// sql.js/WASM initialization is expensive and was being repeated every time
// OpenMarch switched files. Keep one module instance for the lifetime of March3D.
const sqlJsPromise = initSqlJs({ locateFile: () => wasmUrl });

function rows(db: any, sql: string): any[] {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((r: any[]) =>
    Object.fromEntries(result.columns.map((c: string, i: number) => [c, r[i]])),
  );
}

export function prepareDrillPositions(
  drill: Drill,
): Array<Array<PreparedPosition | undefined>> {
  const appearance = new Map(drill.appearances.map((a) => [a.section, a]));
  const marcherIndex = new Map(drill.marchers.map((m, i) => [m.id, i]));
  const pageIndex = new Map(drill.pages.map((p, i) => [p.id, i]));
  const table: Array<Array<PreparedPosition | undefined>> = drill.pages.map(
    () => new Array(drill.marchers.length),
  );

  const stepSizeInches = drill.field.stepSizeInches || 22.5;
  const widthPixels = drill.field.width || 1800;
  const heightPixels = drill.field.height || 960;
  const feetPerStep = stepSizeInches / 12;
  const xCheckpointSteps = (drill.field.xCheckpoints ?? [])
    .map((checkpoint) => Number(checkpoint.stepsFromCenterFront))
    .filter(Number.isFinite);
  const xStepSpan =
    xCheckpointSteps.length >= 2
      ? Math.max(...xCheckpointSteps) - Math.min(...xCheckpointSteps)
      : 160;
  const yCheckpointSteps = (drill.field.yCheckpoints ?? [])
    .map((checkpoint) => Number(checkpoint.stepsFromCenterFront))
    .filter(Number.isFinite);
  const yStepSpan =
    yCheckpointSteps.length >= 2
      ? Math.max(...yCheckpointSteps) - Math.min(...yCheckpointSteps)
      : 85.333333;
  const feetPerPixelX = (xStepSpan * feetPerStep) / widthPixels;
  const feetPerPixelY = (yStepSpan * feetPerStep) / heightPixels;
  const centerX = drill.field.centerFrontPoint?.xPixels ?? widthPixels / 2;
  const frontY = drill.field.centerFrontPoint?.yPixels ?? heightPixels;

  for (const p of drill.positions) {
    const mi = marcherIndex.get(p.marcherId);
    const pi = pageIndex.get(p.pageId);
    if (mi === undefined || pi === undefined) continue;
    const m = drill.marchers[mi];
    table[pi][mi] = {
      x: -(p.x - centerX) * feetPerPixelX,
      z: -160 / 2 + (frontY - p.y) * feetPerPixelY,
      rotation: p.rotation || 0,
      visible: p.visible !== false,
      color: parseColor(
        p.fillColor ?? appearance.get(m.section)?.fillColor,
        "#ff3333",
      ),
    };
  }

  return table;
}

function parseColor(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return value;
  const parts = match[1].split(",").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return fallback;
  return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
}

export async function parseDots(
  buffer: ArrayBuffer,
  sourceName: string,
  includeAudioData = true,
): Promise<Drill> {
  const SQL = await sqlJsPromise;
  const db = new SQL.Database(new Uint8Array(buffer));

  const marchers = rows(
    db,
    `SELECT id,name,section,drill_prefix AS drillPrefix,drill_order AS drillOrder FROM marchers ORDER BY id`,
  ).map((r: any) => ({ ...r, id: +r.id, drillOrder: +r.drillOrder }));
  const beats = rows(
    db,
    `SELECT id,duration,position FROM beats ORDER BY position`,
  ).map((r: any) => ({
    id: +r.id,
    duration: +r.duration,
    position: +r.position,
  }));
  const beatPosition = new Map(beats.map((beat) => [beat.id, beat.position]));
  // OpenMarch stores pages as a linked list. Database IDs are NOT the page
  // order, so reproduce OpenMarch's ordering instead of sorting by ID.
  const pageColumns = rows(db, `PRAGMA table_info(pages)`).map((r: any) =>
    String(r.name),
  );
  let pageRows: any[] = [];
  // Page array indexes are internal implementation details. OpenMarch may number
  // the first visible page/set as 0, 1, 50, etc. Preserve an explicit page
  // number from the database when the schema provides one instead of forcing
  // March3D to add 1 to the array index.
  const pageNumberColumn = [
    "page_number",
    "pageNumber",
    "number",
    "display_number",
    "displayNumber",
    "page_index",
    "pageIndex",
  ].find((name) => pageColumns.includes(name));
  const quotedPageNumberColumn = pageNumberColumn
    ? `, "${pageNumberColumn.replace(/"/g, '""')}" AS displayNumber`
    : "";
  if (
    pageColumns.includes("next_page_id") ||
    pageColumns.includes("previous_page_id")
  ) {
    pageRows = rows(
      db,
      `SELECT id,start_beat AS startBeat${quotedPageNumberColumn}, next_page_id AS nextPageId, previous_page_id AS previousPageId FROM pages`,
    );
    const byId = new Map(pageRows.map((r: any) => [+r.id, r]));
    let first = pageRows.find((r: any) => r.previousPageId == null);
    if (!first) first = pageRows[0];
    const ordered: any[] = [];
    const seen = new Set<number>();
    let current = first;
    while (current && !seen.has(+current.id)) {
      seen.add(+current.id);
      ordered.push(current);
      current = byId.get(Number(current.nextPageId));
    }
    // Fall back to OpenMarch's beat-position ordering if the linked list is
    // incomplete/corrupt, keeping ID only as a deterministic tie-breaker.
    if (ordered.length === pageRows.length) pageRows = ordered;
    else
      pageRows = [...pageRows].sort((a: any, b: any) => {
        const ap = beatPosition.get(+a.startBeat) ?? Number.MAX_SAFE_INTEGER;
        const bp = beatPosition.get(+b.startBeat) ?? Number.MAX_SAFE_INTEGER;
        return ap - bp || +a.id - +b.id;
      });
  } else {
    pageRows = rows(
      db,
      `SELECT id,start_beat AS startBeat${quotedPageNumberColumn} FROM pages`,
    ).sort((a: any, b: any) => {
      const ap = beatPosition.get(+a.startBeat) ?? Number.MAX_SAFE_INTEGER;
      const bp = beatPosition.get(+b.startBeat) ?? Number.MAX_SAFE_INTEGER;
      return ap - bp || +a.id - +b.id;
    });
  }
  // Some OpenMarch versions store the visible page number directly on each
  // page. If not, look for a workspace-level starting page number/offset. The
  // final fallback is zero-based, which matches OpenMarch files whose first
  // visible page is Page 0.
  let workspacePageStart: number | null = null;
  try {
    const workspaceForPages = rows(
      db,
      `SELECT json_data AS jsonData FROM workspace_settings ORDER BY id LIMIT 1`,
    )[0];
    if (workspaceForPages?.jsonData) {
      const settings = JSON.parse(workspaceForPages.jsonData);
      for (const key of [
        "firstPageNumber",
        "startingPageNumber",
        "startPageNumber",
        "pageNumberStart",
        "pageNumberOffset",
      ]) {
        const value = Number(settings?.[key]);
        if (Number.isFinite(value)) {
          workspacePageStart = value;
          break;
        }
      }
    }
  } catch {
    // Older files may not have workspace settings.
  }

  const notesByPage = new Map(
    rows(db, `SELECT id, notes FROM pages`).map((r: any) => [
      +r.id,
      String(r.notes ?? ""),
    ]),
  );
  const pages = pageRows.map((r: any, i: number) => ({
    notes: notesByPage.get(+r.id) ?? "",
    id: +r.id,
    startBeat: +r.startBeat,
    startBeatIndex: beats.findIndex((b) => b.id === +r.startBeat),
    index: i,
    displayNumber: Number.isFinite(Number(r.displayNumber))
      ? Number(r.displayNumber)
      : workspacePageStart != null
        ? workspacePageStart + i
        : i,
  }));
  const positions = rows(
    db,
    `SELECT marcher_id AS marcherId,page_id AS pageId,x,y,rotation_degrees AS rotation,fill_color AS fillColor,visible,label_visible AS labelVisible FROM marcher_pages`,
  ).map((r: any) => ({
    marcherId: +r.marcherId,
    pageId: +r.pageId,
    x: +r.x,
    y: +r.y,
    rotation: +r.rotation,
    fillColor: r.fillColor,
    visible: !!r.visible,
    labelVisible: !!r.labelVisible,
  }));
  const fp = rows(
    db,
    `SELECT json_data AS jsonData FROM field_properties LIMIT 1`,
  )[0];
  const fieldJson = JSON.parse(fp.jsonData);
  const appearances = rows(
    db,
    `SELECT section,fill_color AS fillColor,shape_type AS shapeType FROM section_appearances ORDER BY id`,
  );

  let audioOffsetSeconds = 0;
  let lastPageCounts = 0;
  try {
    const workspace = rows(
      db,
      `SELECT json_data AS jsonData FROM workspace_settings ORDER BY id LIMIT 1`,
    )[0];
    if (workspace?.jsonData) {
      const settings = JSON.parse(workspace.jsonData);
      const parsedOffset = Number(settings.audioOffsetSeconds);
      if (Number.isFinite(parsedOffset)) audioOffsetSeconds = parsedOffset;
    }
  } catch {
    // Older .dots files may not contain workspace_settings/audioOffsetSeconds.
  }

  // OpenMarch stores the count length of the final written page separately,
  // because there is no following page whose start beat can define that span.
  // This is essential for timing the move into the last set correctly.
  try {
    const utility = rows(
      db,
      `SELECT last_page_counts AS lastPageCounts FROM utility ORDER BY id LIMIT 1`,
    )[0];
    const parsedLastPageCounts = Number(utility?.lastPageCounts);
    if (Number.isFinite(parsedLastPageCounts) && parsedLastPageCounts > 0) {
      lastPageCounts = Math.max(1, Math.round(parsedLastPageCounts));
    }
  } catch {
    // Older files may not have the utility table.
  }

  let audio: AudioTrack | null = null;
  if (includeAudioData) {
    try {
      const audioRow = rows(
        db,
        `SELECT id,path,nickname,data,selected FROM audio_files WHERE selected = 1 ORDER BY id LIMIT 1`,
      )[0];
      if (audioRow?.data) {
        audio = {
          id: +audioRow.id,
          path: audioRow.path ?? "",
          nickname: audioRow.nickname ?? null,
          selected: !!audioRow.selected,
          data:
            audioRow.data instanceof Uint8Array
              ? audioRow.data
              : new Uint8Array(audioRow.data),
        };
      }
    } catch {
      // Older .dots files may not contain audio_files.
    }
  }

  db.close();

  return {
    audio,
    audioOffsetSeconds,
    lastPageCounts,
    marchers,
    pages,
    instructions: pages.flatMap((page) =>
      parseMarch3DInstructions(page.notes ?? "", page.index),
    ),
    beats,
    positions,
    appearances,
    field: {
      name: fieldJson.name ?? "OpenMarch field",
      stepSizeInches: fieldJson.stepSizeInches ?? 22.5,
      width: fieldJson.width ?? 1800,
      height: fieldJson.height ?? 960,
      yardNumberCoordinates: fieldJson.yardNumberCoordinates,
      centerFrontPoint: fieldJson.centerFrontPoint,
      xCheckpoints: fieldJson.xCheckpoints,
      yCheckpoints: fieldJson.yCheckpoints,
    },
    sourceName,
  };
}
