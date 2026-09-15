import type { SunVoxEngine, EngineOptions } from "./engine.js";
export * from "./constants.js";
export * from "./engine.js";

export interface PlayerState {
  ready: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  loadedPath: string;
  loadingPath: string;
}
export interface PlayerCallbacks {
  /** Six consecutive Player-owned slots: project, staging and four instruments. */
  slotBase?: number;
  /** Base for song/synth URLs; defaults to the current page URL. */
  resourceBaseUrl?: string | URL;
  workerUrl?: string | URL;
  workletUrl?: string | URL;
  onStateChange?: (state: PlayerState) => void;
  onStatus?: (message: string) => void;
  onLog?: (level: "warn" | "log", message: string) => void;
  onReady?: () => void;
}
export type PlayerOptions = PlayerCallbacks & (
  | { engine: SunVoxEngine; runtimeBaseUrl?: never; workerUrl?: never; workletUrl?: never }
  | (EngineOptions & { engine?: undefined })
);
export interface ControllerValue { controllerIndex: number; value: number }
export interface SunVoxPlayer {
  initialize(): Promise<void>;
  /** Close owned slots. An injected Engine remains alive; an internal Engine is disposed. */
  dispose(): Promise<void>;
  readonly engine: SunVoxEngine;
  getProjectSlot(): number;
  getSlotLayout(): { project: number; staging: number; synths: number[] };
  getSynthSlot(url: string): Promise<{ slot: number; moduleIndex: number } | null>;
  getPlayerState(): PlayerState;
  getMasterVolume(): number;
  setMasterVolume(volume: number): Promise<number>;
  getAudioTransportState(): {
    mode: "message-port" | "shared-array-buffer";
    shared: boolean;
    crossOriginIsolated: boolean;
  };
  loadAndPlay(url: string): Promise<{ loadedPath: string; slot: number } | { cancelled: true }>;
  playLoadedProject(): Promise<{ playing: true; loadedPath: string; slot: number }>;
  stopPlayback(): Promise<boolean>;
  preloadProject(url: string): Promise<boolean>;
  preloadSynth(url: string): Promise<boolean>;
  playSynthNote(url: string, note: number, velocity?: number, track?: number): Promise<boolean>;
  stopSynthNote(note: number, track?: number): Promise<boolean>;
  stopInstrumentNotes(): Promise<boolean>;
  setSynthController(url: string, controllerIndex: number, value: number): Promise<boolean>;
  configureSynthControllers(url: string, controllers: ControllerValue[]): Promise<boolean>;
}
export function createSunVoxPlayer(options: PlayerOptions): SunVoxPlayer;
