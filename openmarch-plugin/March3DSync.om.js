// Name: March3D Sync
// Description: Syncs OpenMarch playback to the local March3D viewer.
// Version: 0.3.34
// Author: March3D
//
// Passive OpenMarch integration.
// Does not patch AudioContext or AudioBufferSourceNode prototypes.
//
// Playback synchronization uses:
// 1. OpenMarch's visible playback clock
// 2. Native HTML media events, when available
// 3. A locally estimated playback clock between updates
//
// IMPORTANT:
// If OpenMarch uses Web Audio exclusively and stops updating its
// visible clock while unfocused, an actual pause cannot always be
// detected without an authoritative OpenMarch playback-state API.

async function March3DSync() {
  const SOCKET_URL = "ws://127.0.0.1:27831";

  const POLL_INTERVAL_MS = 50;
  const DRILL_CHECK_INTERVAL_MS = 2500;
  const RECONNECT_DELAY_MS = 1000;

  const PAUSE_CONFIRMATION_MS = 450;
  const BACKGROUND_CLOCK_GRACE_MS = 1500;
  const POSITION_SEND_INTERVAL_MS = 50;

  let socket = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let drillFileTimer = null;

  let disposed = false;
  let playing = false;

  let lastPosition = null;
  let lastPositionAt = 0;

  let estimatedPosition = 0;
  let estimatedPositionAt = performance.now();

  let lastClockAdvanceAt = 0;
  let lastClockObservationAt = 0;
  let lastPositionSentAt = 0;

  let lastDrillCandidate = null;
  let drillGeneration = 0;

  let clockElement = null;
  let nextClockLookupAt = 0;

  let mediaElement = null;
  let mediaPlaying = null;

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      console.warn("[March3D Sync] Send failed:", error);
    }
  }

  function sendPlayback(force = false) {
    if (force) {
      send({
        type: "playback",
        playing,
        generation: drillGeneration,
      });
    }
  }

  function setPlaying(nextPlaying) {
    const value = Boolean(nextPlaying);

    if (playing === value) {
      return;
    }

    const now = performance.now();

    updateEstimatedPosition(now);

    playing = value;

    estimatedPositionAt = now;

    sendPlayback(true);
  }

  function updateEstimatedPosition(now = performance.now()) {
    if (playing) {
      const elapsed = Math.max(0, (now - estimatedPositionAt) / 1000);

      estimatedPosition += elapsed;
    }

    estimatedPositionAt = now;

    return estimatedPosition;
  }

  function setEstimatedPosition(position, now = performance.now()) {
    if (!Number.isFinite(position)) {
      return;
    }

    estimatedPosition = Math.max(0, position);
    estimatedPositionAt = now;
  }

  function extractDotsStrings(value) {
    if (typeof value !== "string") {
      return [];
    }

    const out = [];

    const windows = value.match(/[A-Za-z]:[\\/][^"'<>|\r\n]*?\.dots/gi) || [];

    const unix =
      value.match(/\/(?:[^"'<>|\r\n/]+\/)*[^"'<>|\r\n/]+\.dots/gi) || [];

    const names = value.match(/[^"'<>|\r\n\/\\]+\.dots/gi) || [];

    for (const item of [...windows, ...unix, ...names]) {
      const clean = item.trim();

      if (clean && !out.includes(clean)) {
        out.push(clean);
      }
    }

    return out;
  }

  function discoverActiveDrillCandidate() {
    const candidates = [];

    const add = (value, weight = 0) => {
      for (const path of extractDotsStrings(value)) {
        candidates.push({
          path,
          weight: weight + (/[A-Za-z]:[\\/]|^\//.test(path) ? 100 : 0),
        });
      }
    };

    add(document.title || "", 40);
    add(location.href || "", 10);

    // Search visible OpenMarch text for the active drill.
    // Do not serialize React state or the application DOM.

    try {
      const root = document.body;

      if (root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

        let node;
        let visited = 0;

        while ((node = walker.nextNode()) && visited++ < 2500) {
          const text = node.nodeValue?.trim();

          if (!text || !/\.dots/i.test(text)) {
            continue;
          }

          add(text, 90);
        }
      }
    } catch {}

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);

          if (!key) {
            continue;
          }

          const value = storage.getItem(key);

          const keyBonus =
            /file|path|database|recent|workspace|show|project/i.test(key)
              ? 35
              : 0;

          add(value || "", keyBonus);
        }
      } catch {}
    }

    candidates.sort(
      (a, b) => b.weight - a.weight || b.path.length - a.path.length,
    );

    return candidates[0]?.path || null;
  }

  function sendActiveDrill(force = false) {
    const candidate = discoverActiveDrillCandidate();

    if (!candidate) {
      return;
    }

    if (!force && candidate === lastDrillCandidate) {
      return;
    }

    const changed = candidate !== lastDrillCandidate;

    lastDrillCandidate = candidate;

    if (changed) {
      drillGeneration += 1;

      // Reset observations when switching drills.
      lastPosition = null;
      lastPositionAt = 0;
      lastClockAdvanceAt = 0;
      lastClockObservationAt = 0;

      setEstimatedPosition(0);

      playing = false;
    }

    send({
      type: "drill-file",
      path: candidate,
      name: candidate.split(/[\\/]/).pop(),
      generation: drillGeneration,
    });

    sendPlayback(true);
  }

  function parseClockText(value) {
    if (typeof value !== "string") {
      return null;
    }

    const match = value.trim().match(/^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/);

    if (!match) {
      return null;
    }

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);

    const millis = Number((match[3] || "0").padEnd(3, "0"));

    if (!Number.isFinite(minutes) || seconds > 59 || !Number.isFinite(millis)) {
      return null;
    }

    return minutes * 60 + seconds + millis / 1000;
  }

  function findOpenMarchClock() {
    try {
      if (clockElement?.isConnected) {
        const value = parseClockText(clockElement.textContent || "");

        if (value != null) {
          return value;
        }
      }

      const now = performance.now();

      if (now < nextClockLookupAt) {
        return null;
      }

      nextClockLookupAt = now + 1000;

      const preferred = document.querySelector(
        "span.font-mono.text-xs, span.font-mono",
      );

      if (preferred) {
        const value = parseClockText(preferred.textContent || "");

        if (value != null) {
          clockElement = preferred;
          return value;
        }
      }

      // Compatibility fallback for older OpenMarch builds.

      const candidates = document.querySelectorAll("span, div, button");

      let visited = 0;

      for (const element of candidates) {
        if (visited++ >= 250) {
          break;
        }

        if (element.children.length > 0) {
          continue;
        }

        const value = parseClockText(element.textContent || "");

        if (value == null) {
          continue;
        }

        const rect = element.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0) {
          clockElement = element;
          return value;
        }
      }
    } catch {}

    return null;
  }

  function findMediaElement() {
    try {
      if (mediaElement?.isConnected) {
        return mediaElement;
      }

      mediaElement = document.querySelector("audio, video");

      return mediaElement;
    } catch {
      return null;
    }
  }

  function updateMediaPlaybackState() {
    const media = findMediaElement();

    if (!media) {
      mediaPlaying = null;
      return;
    }

    const nextPlaying = !media.paused && !media.ended && media.readyState >= 2;

    mediaPlaying = nextPlaying;

    if (nextPlaying) {
      lastClockAdvanceAt = performance.now();
    }

    setPlaying(nextPlaying);
  }

  function onMediaPlay() {
    mediaPlaying = true;
    lastClockAdvanceAt = performance.now();

    setPlaying(true);
  }

  function onMediaPause() {
    mediaPlaying = false;

    setPlaying(false);
  }

  function onMediaSeek() {
    const media = findMediaElement();

    if (!media) {
      return;
    }

    // Prefer OpenMarch's displayed drill time, which already
    // incorporates its workspace audio offset.
    const position = findOpenMarchClock();

    if (position != null) {
      setEstimatedPosition(position);
      lastPosition = position;
      lastPositionAt = performance.now();

      send({
        type: "position",
        position,
        generation: drillGeneration,
      });
    }
  }

  // Capture native media events without changing OpenMarch's
  // own playback implementation.

  document.addEventListener("play", onMediaPlay, true);

  document.addEventListener("playing", onMediaPlay, true);

  document.addEventListener("pause", onMediaPause, true);

  document.addEventListener("ended", onMediaPause, true);

  document.addEventListener("seeked", onMediaSeek, true);

  function pollPlayback() {
    if (disposed) {
      return;
    }

    const now = performance.now();

    updateEstimatedPosition(now);

    const position = findOpenMarchClock();

    const media = findMediaElement();

    // Native media state takes priority when available.
    // It does not depend on whether the window has focus.

    if (media) {
      updateMediaPlaybackState();
    }

    if (position != null) {
      const previous = lastPosition;
      const previousAt = lastPositionAt;

      const elapsed = previousAt > 0 ? (now - previousAt) / 1000 : 0;

      const delta = previous == null ? 0 : position - previous;

      const advancing =
        previous != null &&
        elapsed > 0 &&
        delta > 0.001 &&
        delta < Math.max(0.5, elapsed * 4);

      const jumped =
        previous != null && Math.abs(delta) > Math.max(0.5, elapsed * 4);

      if (advancing) {
        lastClockAdvanceAt = now;

        if (mediaPlaying === null) {
          setPlaying(true);
        }
      }

      if (jumped) {
        // Treat large changes as a seek rather than a
        // play/pause transition.
        setEstimatedPosition(position, now);
      } else if (advancing || !playing) {
        // Re-anchor the estimated position to OpenMarch.
        setEstimatedPosition(position, now);
      } else {
        // Correct gradual drift while playing, but do not
        // drag the estimated clock backward toward a
        // temporarily frozen UI clock.
        const error = position - estimatedPosition;

        if (error > 0) {
          estimatedPosition += Math.min(error, 0.1);
        }
      }

      if (!advancing && !jumped && playing && mediaPlaying === null) {
        const sinceAdvance = now - lastClockAdvanceAt;

        const hidden = document.hidden || !document.hasFocus();

        if (!hidden && sinceAdvance > PAUSE_CONFIRMATION_MS) {
          setPlaying(false);
          setEstimatedPosition(position, now);
        }

        // While unfocused, retain the last known playback
        // state rather than assuming a stalled DOM clock
        // means OpenMarch paused.
        //
        // BACKGROUND_CLOCK_GRACE_MS is used when deciding
        // whether a frozen clock is stale; it does not
        // automatically pause background playback.
        if (hidden && sinceAdvance > BACKGROUND_CLOCK_GRACE_MS) {
          // Keep locally estimated playback running.
        }
      }

      lastPosition = position;
      lastPositionAt = now;
      lastClockObservationAt = now;
    }

    if (now - lastPositionSentAt >= POSITION_SEND_INTERVAL_MS) {
      lastPositionSentAt = now;

      send({
        type: "position",
        position: Math.max(0, estimatedPosition),
        generation: drillGeneration,
      });
    }
  }

  function connect() {
    if (disposed) {
      return;
    }

    try {
      const connection = new WebSocket(SOCKET_URL);

      socket = connection;

      connection.onopen = () => {
        if (disposed || socket !== connection) {
          return;
        }

        sendActiveDrill(true);

        // Report the current state instead of always
        // sending playing:false on every reconnection.
        sendPlayback(true);

        pollPlayback();
      };

      connection.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message?.type === "request-state") {
            // Keep the known playback state, but refresh
            // the clock and drill information.
            lastPosition = null;
            lastPositionAt = 0;

            sendActiveDrill(true);
            sendPlayback(true);
            pollPlayback();
          }
        } catch {}
      };

      connection.onclose = () => {
        if (socket === connection) {
          socket = null;
        }

        if (disposed) {
          return;
        }

        clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      connection.onerror = () => {
        // onclose handles reconnection.
      };
    } catch {
      if (disposed) {
        return;
      }

      clearTimeout(reconnectTimer);

      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }

  pollTimer = setInterval(pollPlayback, POLL_INTERVAL_MS);

  drillFileTimer = setInterval(
    () => sendActiveDrill(false),
    DRILL_CHECK_INTERVAL_MS,
  );

  function cleanup() {
    disposed = true;

    clearInterval(pollTimer);
    clearInterval(drillFileTimer);
    clearTimeout(reconnectTimer);

    document.removeEventListener("play", onMediaPlay, true);

    document.removeEventListener("playing", onMediaPlay, true);

    document.removeEventListener("pause", onMediaPause, true);

    document.removeEventListener("ended", onMediaPause, true);

    document.removeEventListener("seeked", onMediaSeek, true);

    try {
      socket?.close();
    } catch {}

    socket = null;
  }

  window.addEventListener("beforeunload", cleanup, { once: true });

  connect();

  console.log("[March3D Sync] Plugin initialized (v0.3.34)");
}

March3DSync();
