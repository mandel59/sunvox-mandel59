export interface PlayerState {
  ready: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  loadedPath: string;
  loadingPath: string;
}
export interface PlayerOptions {
  /** Directory containing the separately supplied SunVox JS, loader and WASM. */
  runtimeBaseUrl: string | URL;
  /** Base for song/synth URLs; defaults to the current page URL. */
  resourceBaseUrl?: string | URL;
  workerUrl?: string | URL;
  workletUrl?: string | URL;
  onStateChange?: (state: PlayerState) => void;
  onStatus?: (message: string) => void;
  onLog?: (level: "warn" | "log", message: string) => void;
  onReady?: () => void;
}
export interface ControllerValue { controllerIndex: number; value: number }
export interface SunVoxPlayer {
  initialize(): Promise<void>;
  /** Releases resources permanently. Create a new player to restart. */
  dispose(): void;
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
