// Name: March3D Sync
// Description: Syncs OpenMarch playback to the local March3D viewer.
// Version: 0.3.34
// Author: March3D
//
// This plugin is intentionally passive: it does NOT patch OpenMarch's
// AudioContext or AudioBufferSourceNode prototypes. It reads OpenMarch's
// visible playback clock and sends that position to March3D over localhost.

async function March3DSync() {
  let socket = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let playing = false;
  let lastPosition = null;
  let lastPositionAt = 0;
  let lastDrillCandidate = null;

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch {}
    }
  }

  function extractDotsStrings(value) {
    if (typeof value !== "string") return [];
    const out = [];
    const windows = value.match(/[A-Za-z]:[\\/][^"'<>|\r\n]*?\.dots/gi) || [];
    const unix =
      value.match(/\/(?:[^"'<>|\r\n/]+\/)*[^"'<>|\r\n/]+\.dots/gi) || [];
    const names = value.match(/[^"'<>|\r\n\/\\]+\.dots/gi) || [];
    for (const item of [...windows, ...unix, ...names]) {
      const clean = item.trim();
      if (clean && !out.includes(clean)) out.push(clean);
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

    // OpenMarch displays the active .dots path in its toolbar in current
    // desktop builds. Read visible text only; never serialize the React app.
    try {
      const root = document.body;
      if (root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        let visited = 0;
        while ((node = walker.nextNode()) && visited++ < 2500) {
          const text = node.nodeValue?.trim();
          if (!text || !/\.dots/i.test(text)) continue;
          add(text, 90);
        }
      }
    } catch {}

    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key) continue;
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
    if (!candidate) return;
    if (!force && candidate === lastDrillCandidate) return;
    lastDrillCandidate = candidate;
    send({
      type: "drill-file",
      path: candidate,
      name: candidate.split(/[\\/]/).pop(),
    });
  }

  function parseClockText(value) {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!match) return null;
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
      // OpenMarch's AudioClock currently renders its live value in a
      // `font-mono text-xs` span. Prefer that exact presentation before
      // falling back to visible text-node scanning for compatibility.
      const preferred = document.querySelectorAll(
        "span.font-mono.text-xs, span.font-mono",
      );
      for (const element of preferred) {
        const value = parseClockText(element.textContent || "");
        if (value == null) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return value;
      }

      const root = document.body;
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      let visited = 0;
      while ((node = walker.nextNode()) && visited++ < 3000) {
        const text = node.nodeValue?.trim();
        const value = parseClockText(text || "");
        if (value == null) continue;
        const element = node.parentElement;
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return value;
      }
    } catch {}
    return null;
  }

  function pollPlayback() {
    const position = findOpenMarchClock();
    if (position == null) return;

    const now = performance.now();
    const previous = lastPosition;
    const previousAt = lastPositionAt;
    const elapsed = previousAt > 0 ? (now - previousAt) / 1000 : 0;
    const delta = previous == null ? 0 : position - previous;

    // OpenMarch's clock increases while playing and stays fixed while paused.
    // Allow small DOM timing jitter, but reject impossible jumps.
    const advancing =
      previous != null &&
      elapsed > 0 &&
      delta > 0.001 &&
      delta < Math.max(0.5, elapsed * 4);

    if (advancing !== playing) {
      playing = advancing;
      send({ type: "playback", playing });
    }

    lastPosition = position;
    lastPositionAt = now;
    send({ type: "position", position });
  }

  function connect() {
    try {
      socket = new WebSocket("ws://127.0.0.1:27831");
      socket.onopen = () => {
        send({ type: "playback", playing: false });
        sendActiveDrill(true);
        pollPlayback();
      };
      socket.onclose = () => {
        socket = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1000);
      };
      socket.onerror = () => {};
    } catch {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1000);
    }
  }

  // 20 Hz gives March3D plenty of authoritative samples while avoiding a
  // requestAnimationFrame hook inside OpenMarch.
  pollTimer = setInterval(pollPlayback, 50);
  const drillFileTimer = setInterval(() => sendActiveDrill(false), 2500);

  window.addEventListener(
    "beforeunload",
    () => {
      clearInterval(pollTimer);
      clearInterval(drillFileTimer);
      clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {}
    },
    { once: true },
  );

  connect();
}

March3DSync();
