export {};

declare global {
  interface Window {
    march3d?: {
      isElectron: boolean;
      minimizeWindow: () => void;
      toggleMaximizeWindow: () => void;
      isMaximized: () => Promise<boolean>;
      closeWindow: () => void;
      onWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
      openDevTools: () => void;
      inspectElement: (x: number, y: number) => void;
      openDotsFile: () => Promise<{ path: string; name: string } | null>;
      openSyncedDotsFile: () => Promise<{ path: string; name: string } | null>;
      readFile: (path: string) => Promise<Uint8Array>;
      readEmbeddedAudio: (path: string) => Promise<{
        path: string;
        nickname: string | null;
        data: Uint8Array;
      } | null>;
      watchFile: (path: string) => Promise<boolean>;
      stopWatching: () => Promise<void>;
      onDotsChanged: (
        callback: (payload: { path: string }) => void,
      ) => () => void;
      openAudioFile: () => Promise<{
        path: string;
        name: string;
        data: Uint8Array;
      } | null>;
      onOpenMarchSync: (
        callback: (message: OpenMarchSyncMessage) => void,
      ) => () => void;
    };
  }

  type OpenMarchSyncMessage =
    | { type: "connection"; connected: boolean }
    | { type: "playback"; playing: boolean }
    | { type: "position"; position: number }
    | { type: "drill-file"; path: string; name?: string }
    | { type: "page"; pageIndex: number }
    | {
        type: "positions";
        positions: Array<{
          marcherId?: number;
          id?: number;
          x: number;
          y: number;
          rotation?: number;
        }>;
      };
}
