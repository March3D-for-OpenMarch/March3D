import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import Scene from "./viewer/Scene";
import { parseDots, type Drill } from "./lib/dots";
import logoUrl from "./assets/March3D-clear.png";
import * as THREE from "three";

function audioMime(path: string) {
  const ext = path.toLowerCase().split(".").pop();
  return (
    (
      {
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        wav: "audio/wav",
        ogg: "audio/ogg",
        aac: "audio/aac",
        flac: "audio/flac",
      } as Record<string, string>
    )[ext ?? ""] ?? "audio/mpeg"
  );
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function countAtExactBeatTime(
  drill: Drill,
  startBeatIndex: number,
  total: number,
  elapsedInMove: number,
) {
  if (total <= 0) return 0;
  if (elapsedInMove <= 0) return 1;

  let elapsed = 0;
  for (let i = 0; i < total; i++) {
    const beat = drill.beats[startBeatIndex + i];
    const duration = Math.max(0, Number(beat?.duration) || 0);
    elapsed += duration;
    // The next written count begins exactly at the next beat boundary.
    if (elapsedInMove < elapsed - 1e-6) return i + 1;
  }
  return total;
}

function PlaybackBanner({
  drill,
  pageTimes,
  playheadRef,
  duration,
}: {
  drill: Drill;
  pageTimes: number[];
  playheadRef: MutableRefObject<number>;
  duration: number;
}) {
  const setRef = useRef<HTMLSpanElement | null>(null);
  const countRef = useRef<HTMLSpanElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let previousSet = "";
    let previousCount = "";
    let previousTime = "";

    const renderBanner = () => {
      const last = drill.pages.length - 1;
      if (last < 1 || pageTimes.length < 2) {
        frame = requestAnimationFrame(renderBanner);
        return;
      }

      const time = THREE.MathUtils.clamp(
        playheadRef.current,
        0,
        Math.max(duration, 0),
      );

      // Determine the active transition directly from the render-clock ref.
      // Do not use React's sidebar pageIndex here: that state is deliberately
      // throttled for large-band performance and made the count banner pause,
      // then jump two counts at once at faster tempos.
      let interval = 0;
      for (let i = 1; i < pageTimes.length; i++) {
        if (time >= pageTimes[i] - 1e-6) interval = i;
        else break;
      }
      interval = Math.min(interval, last - 1);

      const isFinalInterval = interval === last - 1 && drill.lastPageCounts > 0;
      let fromIndex = interval;
      let toIndex = Math.min(interval + 1, last);
      let total = 0;
      let startBeatIndex = drill.pages[toIndex]?.startBeatIndex ?? 0;

      if (isFinalInterval) {
        // OpenMarch's final-page count span is "Last Set -> End".
        fromIndex = last;
        toIndex = last;
        total = Math.max(1, drill.lastPageCounts);
        startBeatIndex = drill.pages[last]?.startBeatIndex ?? 0;
      } else {
        const nextBoundary = drill.pages[toIndex + 1]?.startBeatIndex;
        total =
          nextBoundary != null
            ? Math.max(1, nextBoundary - startBeatIndex)
            : Math.max(
                1,
                startBeatIndex -
                  (drill.pages[toIndex - 1]?.startBeatIndex ?? 0),
              );
      }

      const moveStartTime = pageTimes[interval] ?? 0;
      const elapsedInMove = Math.max(0, time - moveStartTime);
      const count = countAtExactBeatTime(
        drill,
        startBeatIndex,
        total,
        elapsedInMove,
      );

      const fromLabel = drill.pages[fromIndex]?.displayNumber ?? fromIndex;
      const toLabel = isFinalInterval
        ? "End"
        : String(drill.pages[toIndex]?.displayNumber ?? toIndex);
      const setText = `Set ${fromLabel} → ${toLabel}`;
      const countText = `Count ${String(count).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
      const timeText = `${formatClock(time)} / ${formatClock(duration)}`;

      // Touch the DOM only when visible text actually changes. This keeps the
      // banner sample-accurate to the render clock without causing React/Canvas
      // reconciliation every animation frame.
      if (setText !== previousSet && setRef.current) {
        setRef.current.textContent = setText;
        previousSet = setText;
      }
      if (countText !== previousCount && countRef.current) {
        countRef.current.textContent = countText;
        previousCount = countText;
      }
      if (timeText !== previousTime && timeRef.current) {
        timeRef.current.textContent = timeText;
        previousTime = timeText;
      }

      frame = requestAnimationFrame(renderBanner);
    };

    frame = requestAnimationFrame(renderBanner);
    return () => cancelAnimationFrame(frame);
  }, [drill, pageTimes, playheadRef, duration]);

  return (
    <div className="playback-banner">
      <span ref={setRef} />
      <span ref={countRef} />
      <span ref={timeRef} />
    </div>
  );
}

function OpenMarchSyncRibbon({
  connected,
  playing,
  drillName,
}: {
  connected: boolean;
  playing: boolean;
  drillName: string | null;
}) {
  return (
    <div
      className={`sync-ribbon${connected ? " connected" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="OpenMarch synchronization status"
    >
      <div className="sync-ribbon-brand">
        <span className={`sync-ribbon-dot${connected ? " online" : ""}`} />
        <strong>OpenMarch Sync</strong>
      </div>
      <div className="sync-ribbon-status">
        {connected
          ? playing
            ? "Live playback"
            : "Connected · paused"
          : "Waiting for OpenMarch"}
      </div>
      {connected && drillName && (
        <div className="sync-ribbon-drill" title={drillName}>
          {drillName}
        </div>
      )}
      {!connected && (
        <div className="sync-ribbon-help">
          Install/run the March3D Sync .om.js plugin in OpenMarch
        </div>
      )}
    </div>
  );
}

function PlaybackRibbon({
  duration,
  playhead,
  playing,
  syncActive,
  canPlay,
  onToggle,
  onPrevious,
  onNext,
  onSeek,
  canPrevious,
  canNext,
}: {
  duration: number;
  playhead: number;
  playing: boolean;
  syncActive: boolean;
  canPlay: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  canPrevious: boolean;
  canNext: boolean;
}) {
  return (
    <div className="playback-ribbon" aria-label="Playback controls">
      <button
        type="button"
        className="ribbon-button"
        title="Previous set"
        aria-label="Previous set"
        onClick={onPrevious}
        disabled={!canPrevious}
      >
        <span className="ribbon-skip-icon previous" />
      </button>

      <button
        type="button"
        className="ribbon-play"
        title={
          syncActive
            ? "Playback controlled by OpenMarch"
            : playing
              ? "Pause"
              : "Play"
        }
        aria-label={
          syncActive
            ? "Playback controlled by OpenMarch"
            : playing
              ? "Pause"
              : "Play"
        }
        onClick={onToggle}
        disabled={!canPlay || syncActive}
      >
        {syncActive ? "OM" : playing ? "❚❚" : "▶"}
      </button>

      <button
        type="button"
        className="ribbon-button"
        title="Next set"
        aria-label="Next set"
        onClick={onNext}
        disabled={!canNext}
      >
        <span className="ribbon-skip-icon next" />
      </button>

      <div className="ribbon-time" aria-label="Playback time">
        {formatClock(playhead)}
      </div>

      <input
        className="ribbon-range"
        type="range"
        min="0"
        max={Math.max(0, duration)}
        step="0.01"
        value={Math.min(playhead, duration || 0)}
        aria-label="Playback position"
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={!duration}
      />

      <div className="ribbon-time ribbon-duration">{formatClock(duration)}</div>
    </div>
  );
}

export default function App() {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const [developerMode, setDeveloperMode] = useState(
    () => localStorage.getItem("march3d-developer-mode") === "true",
  );
  const [showDrillInfo, setShowDrillInfo] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [labels, setLabels] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [error, setError] = useState("");
  const [syncConnected, setSyncConnected] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [externalAudio, setExternalAudio] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncConnectedRef = useRef(false);
  const syncEnabledRef = useRef(false);
  const lastOmPositionRef = useRef(0);
  const lastOmPlayingRef = useRef(false);
  const lastOmDrillPathRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const playheadRef = useRef(0);
  const syncAnchorRef = useRef({ position: 0, receivedAt: performance.now() });
  const standaloneAnchorRef = useRef({
    position: 0,
    startedAt: performance.now(),
  });
  const standaloneAudioStartedRef = useRef(false);
  const standaloneAudioLoadingRef = useRef(false);
  const pendingStandalonePlayRef = useRef(false);
  const pendingDotsRef = useRef<{ path: string; changedAt: number } | null>(
    null,
  );
  const refreshingDotsRef = useRef(false);
  const autoOpeningPathRef = useRef<string | null>(null);
  // playheadRef is the *visual* timeline used by the 3D scene.  We keep it
  // continuous and gently steer it toward the authoritative audio/OpenMarch
  // clock instead of replacing it every time a clock sample arrives.  That
  // removes the tiny corrections that showed up as occasional marcher jumps.
  const clockFrameRef = useRef(performance.now());

  function handleDeveloperContextMenu(event: React.MouseEvent) {
    if (!developerMode) return;

    event.preventDefault();
    window.march3d?.inspectElement(event.clientX, event.clientY);
  }

  // Keep the custom title-bar maximize/restore icon in sync with the real
  // Electron window state, including when the window is maximized externally.
  useEffect(() => {
    if (!window.march3d?.isElectron) return;

    let active = true;
    void window.march3d.isMaximized().then((maximized) => {
      if (active) setIsMaximized(maximized);
    });

    return window.march3d.onWindowMaximized((maximized) => {
      setIsMaximized(maximized);
    });
  }, []);

  // Close the custom menu when the user clicks elsewhere or presses Escape.
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // OpenMarch's page start beat marks the beginning of the move INTO that
  // page/set, not the instant its dots should already be fully reached.
  // Therefore Set 0 is anchored at t=0, and Set N (N > 0) is reached at the
  // following page boundary. This is especially important for files that use
  // OpenMarch's zero-duration sentinel beat: without this offset, Set 0 and
  // Set 1 both land at t=0 and playback appears to start on Set 1.
  const pageTimes = useMemo(() => {
    if (!drill || drill.pages.length === 0 || drill.beats.length === 0)
      return [];

    const beatStartTimes = new Array(drill.beats.length).fill(0);
    let elapsed = 0;
    for (let i = 0; i < drill.beats.length; i++) {
      beatStartTimes[i] = elapsed;
      elapsed += Math.max(0, Number(drill.beats[i]?.duration) || 0);
    }

    const movementStarts = drill.pages.map((page) => {
      const index = page.startBeatIndex;
      return index >= 0 && index < beatStartTimes.length
        ? beatStartTimes[index]
        : 0;
    });

    if (movementStarts.length === 1) return [0];

    const arrivals = new Array(movementStarts.length).fill(0);
    arrivals[0] = 0;

    // The move from Set i-1 to Set i occupies the interval that starts on
    // page i and ends when page i+1 begins.
    for (let i = 1; i < movementStarts.length - 1; i++) {
      arrivals[i] = Math.max(arrivals[i - 1], movementStarts[i + 1]);
    }

    // The final written page has no following page boundary, so OpenMarch
    // stores its count length separately in utility.last_page_counts. Use those
    // exact written counts and the real per-beat durations (including tempo
    // changes) for the move into the last set. Falling back to the previous
    // interval is only for older files that do not have last_page_counts.
    const last = movementStarts.length - 1;
    const previousStart = movementStarts[last - 1] ?? 0;
    const lastStart = movementStarts[last] ?? previousStart;
    const lastBeatIndex = drill.pages[last]?.startBeatIndex ?? -1;

    let finalMoveDuration = 0;
    if (drill.lastPageCounts > 0 && lastBeatIndex >= 0) {
      const endBeatIndex = Math.min(
        drill.beats.length,
        lastBeatIndex + drill.lastPageCounts,
      );
      for (let i = lastBeatIndex; i < endBeatIndex; i++) {
        finalMoveDuration += Math.max(0, Number(drill.beats[i]?.duration) || 0);
      }
    }

    if (finalMoveDuration <= 0) {
      finalMoveDuration = Math.max(0, lastStart - previousStart);
      if (last >= 2 && finalMoveDuration <= 0) {
        finalMoveDuration = Math.max(
          0,
          previousStart - (movementStarts[last - 2] ?? 0),
        );
      }
    }

    arrivals[last] = Math.max(
      arrivals[last - 1],
      lastStart + finalMoveDuration,
    );

    return arrivals;
  }, [drill]);

  const page =
    drill?.pages[Math.min(pageIndex, (drill?.pages.length ?? 1) - 1)];
  const sections = useMemo(
    () => (drill ? [...new Set(drill.marchers.map((m) => m.section))] : []),
    [drill],
  );
  const embeddedAudioUrl = useMemo(() => {
    if (!drill?.audio?.data) return null;
    const blob = new Blob(
      [
        drill.audio.data.buffer.slice(
          drill.audio.data.byteOffset,
          drill.audio.data.byteOffset + drill.audio.data.byteLength,
        ) as ArrayBuffer,
      ],
      { type: audioMime(drill.audio.path) },
    );
    return URL.createObjectURL(blob);
  }, [drill]);
  const audioUrl = externalAudio?.url ?? embeddedAudioUrl;
  const pageIndexForTime = useCallback(
    (time: number) => {
      if (!pageTimes.length) return 0;
      let index = 0;
      for (let i = 1; i < pageTimes.length; i++) {
        if (time >= pageTimes[i]) index = i;
        else break;
      }
      return index;
    },
    [pageTimes],
  );

  useEffect(
    () => () => {
      if (embeddedAudioUrl) URL.revokeObjectURL(embeddedAudioUrl);
      if (externalAudio?.url) URL.revokeObjectURL(externalAudio.url);
    },
    [embeddedAudioUrl, externalAudio],
  );

  const loadBuffer = useCallback(
    async (
      buffer: ArrayBuffer | Uint8Array,
      sourceName: string,
      path?: string,
      preservePosition = false,
      includeAudioData = true,
      reuseExistingAudio = !includeAudioData,
    ) => {
      setError("");
      const preservedTime = playheadRef.current;
      try {
        const parsed = await parseDots(
          buffer instanceof Uint8Array
            ? (buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
              ) as ArrayBuffer)
            : buffer,
          sourceName,
          includeAudioData,
        );
        setDrill((current) =>
          includeAudioData || parsed.audio || !reuseExistingAudio
            ? parsed
            : { ...parsed, audio: current?.audio ?? null },
        );
        // Hundreds of DOM-backed labels can overwhelm Chromium before the 3D
        // renderer even starts. Keep labels automatic for normal ensembles and
        // start large files in the fast instanced-rendering path.
        setLabels(parsed.marchers.length <= 180);
        if (preservePosition) {
          playheadRef.current = preservedTime;
          setPlayhead(preservedTime);
        } else {
          setPageIndex(0);
          playheadRef.current = 0;
          setPlayhead(0);
          playingRef.current = false;
          setPlaying(false);
          standaloneAnchorRef.current = {
            position: 0,
            startedAt: performance.now(),
          };
          standaloneAudioStartedRef.current = false;
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = Math.max(
              0,
              -(parsed.audioOffsetSeconds || 0),
            );
          }
          setLoadVersion((v) => v + 1);
        }
        setSourcePath(path ?? null);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : "Could not read .dots file.");
      }
    },
    [],
  );

  async function openFile(file?: File) {
    if (!file) return;
    await loadBuffer(await file.arrayBuffer(), file.name);
  }

  async function openDots() {
    if (window.march3d?.isElectron) {
      // While OpenMarch is synced, "Open .dots" means "open the drill OM
      // currently has open". Never show the operating-system file picker in
      // this mode; OM is the authoritative project selection.
      const result = syncEnabledRef.current
        ? await window.march3d.openSyncedDotsFile()
        : await window.march3d.openDotsFile();

      if (!result) {
        if (syncEnabledRef.current) {
          setError(
            "OpenMarch is synced, but it has not reported an open .dots file yet. Switch/open a drill in OpenMarch and try again.",
          );
        }
        return;
      }

      const bytes = await window.march3d.readFile(result.path);
      setExternalAudio((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return null;
      });
      await loadBuffer(bytes, result.name, result.path);
      await window.march3d.watchFile(result.path);
      return;
    }
    document.getElementById("dots-input")?.click();
  }

  async function chooseAudio() {
    if (window.march3d?.isElectron) {
      const result = await window.march3d.openAudioFile();
      if (!result) return;
      const bytes = result.data;
      const url = URL.createObjectURL(
        new Blob(
          [
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          ],
          { type: audioMime(result.path) },
        ),
      );
      setExternalAudio({ name: result.name, url });
      return;
    }
    document.getElementById("audio-input")?.click();
  }

  async function togglePlayback(force?: boolean) {
    if (syncEnabledRef.current) return;
    const next = force ?? !playingRef.current;
    const audio = audioRef.current;

    if (!next) {
      pendingStandalonePlayRef.current = false;
      playingRef.current = false;
      setPlaying(false);
      standaloneAnchorRef.current = {
        position: playheadRef.current,
        startedAt: performance.now(),
      };
      standaloneAudioStartedRef.current = false;
      audio?.pause();
      return;
    }

    if (duration > 0 && playheadRef.current >= duration - 0.001) {
      playheadRef.current = 0;
      setPlayhead(0);
      setPageIndex(pageIndexForTime(0));
    }

    standaloneAnchorRef.current = {
      position: playheadRef.current,
      startedAt: performance.now(),
    };
    playingRef.current = true;
    setPlaying(true);

    // Desync intentionally does not load the embedded audio immediately. A
    // synced OpenMarch .dots file can contain a large audio track, and parsing
    // that SQLite data on the renderer thread made the first Desync appear to
    // freeze March3D for a long time. Load it lazily only when standalone
    // playback is actually requested.
    if (!audioUrl && sourcePath && window.march3d?.isElectron) {
      pendingStandalonePlayRef.current = true;
      if (!standaloneAudioLoadingRef.current) {
        standaloneAudioLoadingRef.current = true;
        setError("Loading embedded audio for standalone playback…");
        void (async () => {
          try {
            // IMPORTANT: do not call loadBuffer(..., includeAudioData=true)
            // here. That reparses the full .dots database on the React
            // renderer thread and can make a large drill appear frozen for a
            // long time. Electron extracts only the selected audio BLOB in the
            // main process, while the current drill/3D data stays untouched.
            const embedded =
              await window.march3d!.readEmbeddedAudio(sourcePath);
            if (!embedded?.data?.byteLength) {
              throw new Error(
                "No embedded audio track was found in this drill.",
              );
            }

            const url = URL.createObjectURL(
              new Blob(
                [
                  embedded.data.buffer.slice(
                    embedded.data.byteOffset,
                    embedded.data.byteOffset + embedded.data.byteLength,
                  ) as ArrayBuffer,
                ],
                { type: audioMime(embedded.path) },
              ),
            );

            setExternalAudio((current) => {
              if (current?.url) URL.revokeObjectURL(current.url);
              return {
                name:
                  embedded.nickname ||
                  embedded.path.split(/[\\/]/).pop() ||
                  "Embedded audio",
                url,
              };
            });
          } catch (e) {
            console.error("Could not load standalone audio", e);
            pendingStandalonePlayRef.current = false;
            playingRef.current = false;
            setPlaying(false);
            setError(
              `Audio could not be loaded: ${e instanceof Error ? e.message : "unknown error"}`,
            );
          } finally {
            standaloneAudioLoadingRef.current = false;
          }
        })();
      }
      return;
    }

    if (!audio || !audioUrl) return;
    const sourceTime = playheadRef.current - (drill?.audioOffsetSeconds ?? 0);
    if (sourceTime >= 0) {
      audio.currentTime = sourceTime;
      standaloneAudioStartedRef.current = true;
      try {
        await audio.play();
      } catch (e) {
        playingRef.current = false;
        setPlaying(false);
        standaloneAudioStartedRef.current = false;
        setError(
          `Audio could not start: ${e instanceof Error ? e.message : "browser blocked playback"}`,
        );
      }
    } else {
      // Positive OpenMarch offsets pad the audio with silence. The render clock
      // starts immediately and the real audio begins when the padded time ends.
      audio.pause();
      audio.currentTime = 0;
      standaloneAudioStartedRef.current = false;
    }
  }

  function seekToPage(index: number) {
    const safe = Math.max(0, Math.min(index, (drill?.pages.length ?? 1) - 1));
    setPageIndex(safe);
    const time = pageTimes[safe] ?? 0;
    playheadRef.current = time;
    setPlayhead(time);
    standaloneAnchorRef.current = {
      position: time,
      startedAt: performance.now(),
    };
    if (audioRef.current && !syncEnabledRef.current) {
      audioRef.current.currentTime = Math.max(
        0,
        time - (drill?.audioOffsetSeconds ?? 0),
      );
    }
  }

  async function resyncWithOpenMarch() {
    if (!syncConnectedRef.current) {
      setError("OpenMarch Sync is not connected.");
      return;
    }

    syncEnabledRef.current = true;
    setSyncEnabled(true);
    setError("");

    // OpenMarch owns the audio while synchronized. Stop any standalone audio
    // before we hand the timeline back to OM.
    audioRef.current?.pause();
    standaloneAudioStartedRef.current = false;

    // Make sure March3D is showing the same drill OM currently has open.
    try {
      const current = window.march3d?.isElectron
        ? await window.march3d.openSyncedDotsFile()
        : null;
      if (current?.path && current.path !== sourcePath) {
        const bytes = await window.march3d!.readFile(current.path);
        setExternalAudio((existing) => {
          if (existing?.url) URL.revokeObjectURL(existing.url);
          return null;
        });
        await loadBuffer(
          bytes,
          current.name ||
            current.path.split(/[\\/]/).pop() ||
            "OpenMarch drill",
          current.path,
          false,
          false,
          false,
        );
        await window.march3d!.watchFile(current.path);
        lastOmDrillPathRef.current = current.path;
      }
    } catch (e) {
      console.error("Could not resync the OpenMarch drill", e);
      setError(
        `Could not resync with OpenMarch: ${e instanceof Error ? e.message : "unknown error"}`,
      );
      return;
    }

    const position = Math.max(0, Number(lastOmPositionRef.current) || 0);
    // Keep the raw OM position here. If the resync also had to load a new
    // drill, React may not have committed its new timeline yet; the render
    // clock will clamp the position against the new duration on the next frame.
    playheadRef.current = position;
    setPlayhead(position);
    syncAnchorRef.current = {
      position,
      receivedAt: performance.now(),
    };
    playingRef.current = lastOmPlayingRef.current;
    setPlaying(lastOmPlayingRef.current);
  }

  function syncWithOpenMarch() {
    void resyncWithOpenMarch();
  }

  function desyncFromOpenMarch() {
    if (!syncEnabledRef.current) return;

    syncEnabledRef.current = false;
    setSyncEnabled(false);
    // Keep the current visual position, but stop treating OpenMarch as the
    // authoritative transport. This immediately makes local play/pause usable.
    playingRef.current = false;
    setPlaying(false);
    standaloneAnchorRef.current = {
      position: playheadRef.current,
      startedAt: performance.now(),
    };
    standaloneAudioStartedRef.current = false;
    audioRef.current?.pause();
    setError("");

    // Do not read/parse the .dots audio here. Synced files can contain a large
    // embedded track, and doing that work during Desync blocks the renderer.
    // Standalone audio is loaded lazily the next time the user presses Play.
    pendingStandalonePlayRef.current = false;
  }

  // OpenMarch can touch a .dots SQLite database many times during a single UI
  // operation. Only queue a lightweight path notification here. The file is
  // read once after it has been quiet for a while, and never while OM playback
  // is running. This prevents large embedded-audio databases from flooding IPC.
  useEffect(() => {
    if (!window.march3d) return;
    return window.march3d.onDotsChanged(({ path }) => {
      if (!sourcePath || path !== sourcePath) return;
      pendingDotsRef.current = { path, changedAt: performance.now() };
    });
  }, [sourcePath]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const pending = pendingDotsRef.current;
      if (!pending || playingRef.current || refreshingDotsRef.current) return;
      // Wait until OpenMarch has stopped writing for two seconds. A slider drag
      // or multi-step edit may generate dozens of SQLite writes.
      if (performance.now() - pending.changedAt < 2000) return;

      pendingDotsRef.current = null;
      refreshingDotsRef.current = true;
      void (async () => {
        try {
          const bytes = await window.march3d!.readFile(pending.path);
          // Keep the already-loaded audio blob. Re-reading an 18+ MB embedded
          // track just to update dots/sets is unnecessary and caused long stalls.
          await loadBuffer(
            bytes,
            pending.path.split(/[\\/]/).pop() ?? "OpenMarch drill",
            pending.path,
            true,
            false,
            true,
          );
        } finally {
          refreshingDotsRef.current = false;
        }
      })();
    }, 250);
    return () => window.clearInterval(timer);
  }, [loadBuffer]);

  useEffect(() => {
    if (!window.march3d) return;
    return window.march3d.onOpenMarchSync((message) => {
      if (message.type === "drill-file") {
        const path = message.path;
        lastOmDrillPathRef.current = path || null;
        if (!syncEnabledRef.current) return;
        if (!path || path === sourcePath || autoOpeningPathRef.current === path)
          return;
        autoOpeningPathRef.current = path;
        void (async () => {
          try {
            // Let the current frame paint before starting a show switch. More
            // importantly, OpenMarch owns audio while synced, so do not pull a
            // 10-50 MB embedded audio blob through sql.js just to render drill.
            // This makes switching OM files much less likely to hitch/freeze.
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const bytes = await window.march3d!.readFile(path);
            setExternalAudio((current) => {
              if (current?.url) URL.revokeObjectURL(current.url);
              return null;
            });
            await loadBuffer(
              bytes,
              message.name || path.split(/[\\/]/).pop() || "OpenMarch drill",
              path,
              false,
              false,
              false,
            );
            await window.march3d!.watchFile(path);
          } catch (e) {
            console.error("Could not auto-open OpenMarch drill", e);
            setError(
              `OpenMarch is synced, but March3D could not open its drill: ${e instanceof Error ? e.message : "unknown error"}`,
            );
          } finally {
            autoOpeningPathRef.current = null;
          }
        })();
        return;
      }

      if (message.type === "connection") {
        syncConnectedRef.current = message.connected;
        setSyncConnected(message.connected);

        if (message.connected) {
          // A new OpenMarch connection starts synchronized, preserving the
          // existing behavior. Users can explicitly Desync from the Sync tab.
          syncEnabledRef.current = true;
          setSyncEnabled(true);
          audioRef.current?.pause();
          playingRef.current = false;
          setPlaying(false);
          syncAnchorRef.current = {
            position: playheadRef.current,
            receivedAt: performance.now(),
          };
        } else {
          // A real disconnect must release the playback lock so the local Play
          // button becomes usable again.
          if (syncEnabledRef.current) {
            syncEnabledRef.current = false;
            setSyncEnabled(false);
            playingRef.current = false;
            setPlaying(false);
          }
          lastOmPlayingRef.current = false;
        }
        return;
      }

      if (message.type === "position") {
        const time = Number(message.position);
        if (!Number.isFinite(time)) return;
        // The sync plugin sends OpenMarch's LIVE DRILL PLAYBACK POSITION,
        // not raw audio-file time. OpenMarch has already accounted for the
        // workspace audio offset before this value reaches us. Applying
        // audioOffsetSeconds again made negative-offset shows (for example
        // -6.5 s) render that many seconds BEHIND OpenMarch.
        const safeTime = Math.max(0, time);
        lastOmPositionRef.current = safeTime;
        // Never let the local audio element drive the synced timeline.
        // OpenMarch's Web Audio clock is authoritative while Sync is enabled.
        if (syncEnabledRef.current) {
          // Do not seek the paused HTMLAudioElement for every OpenMarch clock
          // packet. currentTime writes are expensive media seeks and were a
          // major source of renderer stalls on large drills.
          const receivedAt = performance.now();
          syncAnchorRef.current = { position: safeTime, receivedAt };

          // While OpenMarch is playing, do not hard-snap the 3D playhead to
          // every incoming packet. The render clock below slews toward this
          // new authoritative position over a few frames. When paused, a
          // position packet represents a seek/scrub and should be immediate.
          if (!playingRef.current) {
            // Store the seek in refs only. The RAF loop below owns React UI
            // updates, avoiding bursts of App/Canvas reconciliation while OM
            // scrubs or changes pages.
            playheadRef.current = safeTime;
          }
        }
        return;
      }

      if (message.type === "playback") {
        // Always remember OM's transport state so Resync can snap back to the
        // latest OpenMarch playback state. Only apply it to March3D while Sync
        // is enabled.
        lastOmPlayingRef.current = !!message.playing;
        if (!syncEnabledRef.current) return;

        playingRef.current = !!message.playing;
        setPlaying(!!message.playing);
        syncAnchorRef.current = {
          position: lastOmPositionRef.current,
          receivedAt: performance.now(),
        };
        return;
      }
    });
  }, [pageIndexForTime, drill?.audioOffsetSeconds, sourcePath, loadBuffer]);

  const duration = pageTimes.length
    ? Math.max(pageTimes[pageTimes.length - 1], 0)
    : 0;

  useEffect(() => {
    if (
      syncEnabledRef.current ||
      !audioUrl ||
      !pendingStandalonePlayRef.current
    )
      return;
    const audio = audioRef.current;
    if (!audio) return;

    pendingStandalonePlayRef.current = false;
    const sourceTime = Math.max(
      0,
      playheadRef.current - (drill?.audioOffsetSeconds ?? 0),
    );
    audio.currentTime = sourceTime;
    standaloneAudioStartedRef.current = true;
    setError("");
    void audio.play().catch((e) => {
      playingRef.current = false;
      setPlaying(false);
      standaloneAudioStartedRef.current = false;
      setError(
        `Audio could not start: ${e instanceof Error ? e.message : "browser blocked playback"}`,
      );
    });
  }, [audioUrl, drill?.audioOffsetSeconds]);

  // Developer shortcut and drill info sidebar shortcut.
  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (developerMode && event.ctrlKey && event.shiftKey && key === "i") {
        event.preventDefault();
        window.march3d?.openDevTools();
        return;
      }

      if (event.ctrlKey && !event.shiftKey && !event.altKey && key === "b") {
        event.preventDefault();
        setShowDrillInfo((current) => !current);
        return;
      }

      // Spacebar is the global play/pause shortcut. Do not steal it while the
      // user is typing in a text field or interacting with another form control.
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (
        key === " " &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !isEditable
      ) {
        event.preventDefault();
        void togglePlayback();
      }
    };

    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [
    developerMode,
    syncEnabled,
    duration,
    audioUrl,
    drill?.audioOffsetSeconds,
    pageIndexForTime,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => {
      // The drill timeline, not the raw audio-file length, decides where the
      // animation ends. If the audio ends first, continue the drill silently.
      standaloneAudioStartedRef.current = false;
      if (
        !syncEnabledRef.current &&
        duration > 0 &&
        playheadRef.current >= duration - 0.02
      ) {
        playingRef.current = false;
        setPlaying(false);
        playheadRef.current = duration;
        setPlayhead(duration);
        setPageIndex(Math.max(0, (drill?.pages.length ?? 1) - 1));
      }
    };

    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [audioUrl, drill?.pages.length, duration]);

  // Render-time transport clock. The 3D scene follows a continuous visual
  // clock rather than directly copying audio.currentTime or each OpenMarch
  // packet. Audio/OpenMarch remains authoritative, but small timing errors are
  // corrected gradually (clock slewing). Large errors still snap immediately
  // because those are real seeks, stops, or transport discontinuities.
  useEffect(() => {
    let frame = 0;
    let lastUiUpdate = 0;
    clockFrameRef.current = performance.now();

    const tick = (now: number) => {
      const rawDt = Math.max(0, (now - clockFrameRef.current) / 1000);
      clockFrameRef.current = now;
      // Do not let a temporarily blocked renderer create a huge animation leap
      // on the first frame after it recovers.
      const dt = Math.min(rawDt, 0.1);

      let visualTime = playheadRef.current;
      let desiredTime = visualTime;
      let advancing = false;

      if (syncEnabledRef.current) {
        const anchor = syncAnchorRef.current;
        desiredTime = anchor.position;
        if (playingRef.current) {
          desiredTime += Math.max(0, now - anchor.receivedAt) / 1000;
          advancing = true;
        }
      } else if (playingRef.current) {
        const anchor = standaloneAnchorRef.current;
        desiredTime =
          anchor.position + Math.max(0, now - anchor.startedAt) / 1000;
        advancing = true;

        const audio = audioRef.current;
        if (audio && audioUrl && !standaloneAudioStartedRef.current) {
          const sourceTime = desiredTime - (drill?.audioOffsetSeconds ?? 0);
          if (sourceTime >= 0) {
            standaloneAudioStartedRef.current = true;
            audio.currentTime = sourceTime;
            void audio.play().catch(() => {
              standaloneAudioStartedRef.current = false;
            });
          }
        }
      }

      if (advancing) {
        // Advance locally at normal speed every render frame. Then gently
        // correct drift toward the source clock. This avoids visible 20-50 ms
        // corrections while still keeping audio/drill synchronization tight.
        let predicted = visualTime + dt;
        const error = desiredTime - predicted;

        // A difference this large is almost certainly a real seek, a resumed
        // suspended tab, or a transport discontinuity rather than normal jitter.
        if (Math.abs(error) > 0.35) {
          predicted = desiredTime;
        } else {
          // Exponential smoothing is frame-rate independent. About 95% of a
          // small error is removed in roughly half a second without a jump.
          const correction = 1 - Math.exp(-6 * dt);
          predicted += error * correction;
        }
        visualTime = predicted;
      } else {
        // When stopped/paused, follow explicit seeks exactly.
        visualTime = desiredTime;
      }

      if (duration > 0)
        visualTime = THREE.MathUtils.clamp(visualTime, 0, duration);
      else visualTime = Math.max(0, visualTime);

      if (
        !syncEnabledRef.current &&
        playingRef.current &&
        duration > 0 &&
        visualTime >= duration - 0.0005
      ) {
        visualTime = duration;
        playingRef.current = false;
        standaloneAudioStartedRef.current = false;
        standaloneAnchorRef.current = { position: duration, startedAt: now };
        audioRef.current?.pause();
        setPlaying(false);
      }
      playheadRef.current = visualTime;

      // Keep React/UI work out of the 3D render path. Large or OM-synced drills
      // only need a 5 Hz sidebar refresh; the marcher animation still reads the
      // ref every display frame and stays smooth.
      const uiInterval =
        syncEnabledRef.current || (drill?.marchers.length ?? 0) > 160
          ? 200
          : 100;
      if (now - lastUiUpdate >= uiInterval) {
        lastUiUpdate = now;
        setPlayhead((current) =>
          Math.abs(current - visualTime) < 0.015 ? current : visualTime,
        );
        const nextPageIndex = pageIndexForTime(visualTime);
        setPageIndex((current) =>
          current === nextPageIndex ? current : nextPageIndex,
        );
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    duration,
    pageIndexForTime,
    audioUrl,
    drill?.audioOffsetSeconds,
    drill?.marchers.length,
  ]);

  return (
    <div className="app" onContextMenu={handleDeveloperContextMenu}>
      <nav className="top-bar" ref={menuRef} aria-label="Application menu">
        <div className="brand">
          <img src={logoUrl} alt="March3D" className="brand-logo" />
          <div>
            <strong>March3D</strong>
            <span className="subtitle">
              OpenMarch 3D Viewer · v{__APP_VERSION__}
            </span>
          </div>
        </div>

        <div className="window-controls" aria-label="Window controls">
          <button
            type="button"
            title="Minimize"
            aria-label="Minimize"
            onClick={() => window.march3d?.minimizeWindow()}
          >
            <span className="minimize-icon" />
          </button>
          <button
            type="button"
            title="Maximize or restore"
            aria-label="Maximize or restore"
            onClick={() => window.march3d?.toggleMaximizeWindow()}
          >
            <span
              className={`maximize-icon${isMaximized ? " is-maximized" : ""}`}
            />
          </button>
          <button
            type="button"
            className="close-window"
            title="Close"
            aria-label="Close"
            onClick={() => window.march3d?.closeWindow()}
          >
            <span className="close-icon" />
          </button>
        </div>
      </nav>
      <header>
        <nav className="menu-bar" ref={menuRef} aria-label="Application menu">
          {["File", "Sync", "View", "Settings"].map((menu) => (
            <div className="menu-group" key={menu}>
              <button
                type="button"
                className={`menu-trigger${openMenu === menu ? " active" : ""}`}
                aria-haspopup="true"
                aria-expanded={openMenu === menu}
                onClick={() =>
                  setOpenMenu((current) => (current === menu ? null : menu))
                }
              >
                {menu}
              </button>
              {openMenu === menu && (
                <div className="menu-dropdown" role="menu">
                  {menu === "File" && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          void openDots();
                        }}
                      >
                        Open .dots
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          void chooseAudio();
                        }}
                      >
                        Open Audio
                      </button>
                      <div className="menu-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          window.close();
                        }}
                      >
                        Exit
                      </button>
                    </>
                  )}
                  {menu === "Sync" && (
                    <>
                      <div className="menu-section-label">OpenMarch</div>
                      <div className="sync-menu-status">
                        <span
                          className={`sync-menu-dot${syncConnected ? " online" : ""}`}
                        />
                        <span>
                          {syncConnected
                            ? syncEnabled
                              ? playing
                                ? "Connected · Synced · Live playback"
                                : "Connected · Synced · Paused"
                              : "Connected · Desynced"
                            : "Disconnected"}
                        </span>
                      </div>
                      {drill?.sourceName && (
                        <div
                          className="sync-menu-drill"
                          title={drill.sourceName}
                        >
                          {drill.sourceName}
                        </div>
                      )}
                      <div className="menu-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!syncConnected}
                        onClick={() => {
                          setOpenMenu(null);
                          syncWithOpenMarch();
                        }}
                      >
                        Sync with OpenMarch
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!syncConnected}
                        onClick={() => {
                          setOpenMenu(null);
                          void resyncWithOpenMarch();
                        }}
                      >
                        Resync with OpenMarch
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!syncEnabled}
                        onClick={() => {
                          setOpenMenu(null);
                          void desyncFromOpenMarch();
                        }}
                      >
                        Desync from OpenMarch
                      </button>
                      <div className="menu-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          void openDots();
                        }}
                      >
                        {syncEnabled ? "Open Synced Drill" : "Open .dots"}
                      </button>
                      {!syncConnected && (
                        <div className="sync-menu-help">
                          Run the March3D Sync .om.js plugin in OpenMarch to
                          connect.
                        </div>
                      )}
                    </>
                  )}
                  {menu === "View" && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowDrillInfo((current) => !current);
                          setOpenMenu(null);
                        }}
                      >
                        <span>
                          {showDrillInfo ? "✓  Drill Info" : "Drill Info"}
                        </span>
                        <span className="menu-shortcut">Ctrl+B</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setLabels((current) => !current);
                          setOpenMenu(null);
                        }}
                      >
                        {labels ? "Hide Marcher Labels" : "Show Marcher Labels"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          if (document.fullscreenElement)
                            void document.exitFullscreen();
                          else
                            void document.documentElement.requestFullscreen();
                        }}
                      >
                        Toggle Fullscreen
                      </button>
                    </>
                  )}
                  {menu === "Settings" && (
                    <>
                      <div className="menu-section-label">Display</div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setLabels((current) => !current);
                          setOpenMenu(null);
                        }}
                      >
                        {labels ? "✓  Marcher Labels" : "Marcher Labels"}
                      </button>
                      <div className="menu-divider" />
                      <div className="menu-section-label">Application</div>
                      <button type="button" role="menuitem" disabled>
                        Preferences (coming soon)
                      </button>
                      <div className="menu-divider" />

                      <div className="menu-section-label">Developer</div>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const next = !developerMode;

                          setDeveloperMode(next);
                          localStorage.setItem(
                            "march3d-developer-mode",
                            String(next),
                          );
                        }}
                      >
                        {developerMode ? "✓ Developer Mode" : "Developer Mode"}
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        disabled={!developerMode}
                        onClick={() => {
                          setOpenMenu(null);
                          window.march3d?.openDevTools();
                        }}
                      >
                        Open Developer Tools
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
        {drill && <div className="source">{drill.sourceName}</div>}
      </header>
      <main>
        <section className="viewer">
          {drill && drill.pages.length >= 2 && (
            <PlaybackBanner
              drill={drill}
              pageTimes={pageTimes}
              playheadRef={playheadRef}
              duration={duration}
            />
          )}
          {drill && (
            <PlaybackRibbon
              duration={duration}
              playhead={playhead}
              playing={playing}
              syncActive={syncEnabled}
              canPlay={Boolean(audioUrl || (drill && !syncEnabled))}
              onToggle={() => void togglePlayback()}
              onPrevious={() => seekToPage(pageIndex - 1)}
              onNext={() => seekToPage(pageIndex + 1)}
              onSeek={(time) => {
                playheadRef.current = time;
                syncAnchorRef.current = {
                  position: time,
                  receivedAt: performance.now(),
                };
                setPlayhead(time);
                setPageIndex(pageIndexForTime(time));
                standaloneAnchorRef.current = {
                  position: time,
                  startedAt: performance.now(),
                };
                if (audioRef.current && !syncEnabled)
                  audioRef.current.currentTime = Math.max(
                    0,
                    time - (drill.audioOffsetSeconds ?? 0),
                  );
              }}
              canPrevious={pageIndex > 0}
              canNext={pageIndex < drill.pages.length - 1}
            />
          )}
          {drill && page ? (
            <Scene
              key={drill.sourceName}
              drill={drill}
              labels={labels}
              pageTimes={pageTimes}
              playheadRef={playheadRef}
              resetToken={`${sourcePath ?? drill.sourceName}:${loadVersion}`}
            />
          ) : (
            <div className="empty">
              <h1>Open an OpenMarch drill</h1>
              <p>
                Choose a <b>.dots</b> file to load its field, marchers,
                sections, sets, and embedded audio.
              </p>
              <button className="button" onClick={openDots}>
                Choose .dots
              </button>
            </div>
          )}
        </section>
        {showDrillInfo && (
          <aside>
            <h2>Drill</h2>
            {drill ? (
              <>
                <div className="stat">
                  <span>Field</span>
                  <b>{drill.field.name}</b>
                </div>
                <div className="stat">
                  <span>Marchers</span>
                  <b>{drill.marchers.length}</b>
                </div>
                <div className="stat">
                  <span>Sets</span>
                  <b>{drill.pages.length}</b>
                </div>
                <div className="stat">
                  <span>Sections</span>
                  <b>{sections.length}</b>
                </div>
                <div className="sync-status">
                  <span className={syncConnected ? "dot online" : "dot"}></span>
                  {syncConnected
                    ? syncEnabled
                      ? "OpenMarch synced"
                      : "OpenMarch connected · desynced"
                    : "Standalone mode"}
                </div>
                <hr />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={labels}
                    onChange={(e) => setLabels(e.target.checked)}
                  />{" "}
                  Labels
                </label>
                <h3>Playback</h3>
                <div className="play-row">
                  <button
                    onClick={() => seekToPage(pageIndex - 1)}
                    disabled={pageIndex === 0}
                  >
                    ◀
                  </button>
                  <button
                    className="big-play"
                    disabled={!audioUrl && syncEnabled}
                    onClick={() => void togglePlayback()}
                  >
                    {syncEnabled ? "OM" : playing ? "❚❚" : "▶"}
                  </button>
                  <button
                    onClick={() => seekToPage(pageIndex + 1)}
                    disabled={pageIndex === drill.pages.length - 1}
                  >
                    ▶
                  </button>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max={Math.max(0, duration)}
                  step="0.01"
                  value={Math.min(playhead, duration || 0)}
                  onChange={(e) => {
                    const time = +e.target.value;
                    playheadRef.current = time;
                    syncAnchorRef.current = {
                      position: time,
                      receivedAt: performance.now(),
                    };
                    setPlayhead(time);
                    setPageIndex(pageIndexForTime(time));
                    standaloneAnchorRef.current = {
                      position: time,
                      startedAt: performance.now(),
                    };
                    if (audioRef.current && !syncEnabled)
                      audioRef.current.currentTime = Math.max(
                        0,
                        time - (drill?.audioOffsetSeconds ?? 0),
                      );
                  }}
                />
                <div className="time">
                  <span>
                    Set {drill.pages[pageIndex]?.displayNumber ?? pageIndex}
                  </span>
                  <span>
                    {Math.floor(playhead / 60)}:
                    {String(Math.floor(playhead % 60)).padStart(2, "0")}
                  </span>
                </div>
                <h3>
                  Set {drill.pages[pageIndex]?.displayNumber ?? pageIndex}
                </h3>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max={Math.max(0, drill.pages.length - 1)}
                  value={pageIndex}
                  onChange={(e) => seekToPage(+e.target.value)}
                />
                <div className="setnav">
                  <button
                    disabled={pageIndex === 0}
                    onClick={() => seekToPage(pageIndex - 1)}
                  >
                    Previous
                  </button>
                  <button
                    disabled={pageIndex === drill.pages.length - 1}
                    onClick={() => seekToPage(pageIndex + 1)}
                  >
                    Next
                  </button>
                </div>
                <p className="hint">
                  Mouse: orbit · Wheel: zoom · Right mouse: pan
                </p>
                <div className="audio-info">
                  <b>Audio</b>
                  <span>
                    {externalAudio?.name ??
                      drill.audio?.nickname ??
                      drill.audio?.path?.split(/[\\/]/).pop() ??
                      "No audio loaded"}
                  </span>
                </div>
                <h3>Sections</h3>
                <div className="sections">
                  {sections.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="hint">No drill loaded.</p>
            )}
            {error && <div className="error">{error}</div>}
          </aside>
        )}
      </main>
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="none" />}
    </div>
  );
}
