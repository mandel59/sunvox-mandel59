export interface BufferResult<T> { result: number; data: T }
export interface EngineOptions {
  runtimeBaseUrl: string | URL;
  resourceBaseUrl?: string | URL;
  workerUrl?: string | URL;
  workletUrl?: string | URL;
  sampleRate?: number;
  /** SunVox configuration string. Defaults to the native default (null). */
  config?: string;
  onLog?: (level: "log" | "warn", message: string) => void;
}
export interface EngineMethods {
  sv_get_sample_rate(): Promise<number>;
  sv_open_slot(slot: number): Promise<number>;
  sv_close_slot(slot: number): Promise<number>;
  sv_load_from_memory(slot: number, byte_array: Uint8Array): Promise<number>;
  sv_save_to_memory(slot: number): Promise<Uint8Array | null>;
  sv_play(slot: number): Promise<number>;
  sv_play_from_beginning(slot: number): Promise<number>;
  sv_stop(slot: number): Promise<number>;
  sv_pause(slot: number): Promise<number>;
  sv_resume(slot: number): Promise<number>;
  sv_sync_resume(slot: number): Promise<number>;
  sv_set_autostop(slot: number, autostop: number): Promise<number>;
  sv_get_autostop(slot: number): Promise<number>;
  sv_end_of_song(slot: number): Promise<number>;
  sv_rewind(slot: number, line_num: number): Promise<number>;
  sv_volume(slot: number, vol: number): Promise<number>;
  sv_set_event_t(slot: number, set: number, t: number): Promise<number>;
  sv_send_event(slot: number, track: number, note: number, vel: number, module: number, ctl: number, ctl_val: number): Promise<number>;
  sv_get_current_line(slot: number): Promise<number>;
  sv_get_current_line2(slot: number): Promise<number>;
  sv_get_current_signal_level(slot: number, channel: number): Promise<number>;
  sv_get_song_name(slot: number): Promise<string>;
  sv_set_song_name(slot: number, name: string): Promise<number>;
  sv_get_base_version(slot: number): Promise<number>;
  sv_get_song_bpm(slot: number): Promise<number>;
  sv_get_song_tpl(slot: number): Promise<number>;
  sv_get_song_length_frames(slot: number): Promise<number>;
  sv_get_song_length_lines(slot: number): Promise<number>;
  sv_get_time_map(slot: number, start_line: number, len: number, flags: number): Promise<BufferResult<Uint32Array>>;
  sv_new_module(slot: number, type: string, name: string, x: number, y: number, z: number): Promise<number>;
  sv_remove_module(slot: number, mod_num: number): Promise<number>;
  sv_connect_module(slot: number, source: number, destination: number): Promise<number>;
  sv_disconnect_module(slot: number, source: number, destination: number): Promise<number>;
  sv_load_module_from_memory(slot: number, byte_array: Uint8Array, x: number, y: number, z: number): Promise<number>;
  sv_sampler_load_from_memory(slot: number, mod_num: number, byte_array: Uint8Array, sample_slot: number): Promise<number>;
  sv_sampler_par(slot: number, mod_num: number, sample_slot: number, par: number, par_val: number, set: number): Promise<number>;
  sv_metamodule_load_from_memory(slot: number, mod_num: number, byte_array: Uint8Array): Promise<number>;
  sv_vplayer_load_from_memory(slot: number, mod_num: number, byte_array: Uint8Array): Promise<number>;
  sv_get_number_of_modules(slot: number): Promise<number>;
  sv_find_module(slot: number, name: string): Promise<number>;
  sv_get_module_flags(slot: number, mod_num: number): Promise<number>;
  sv_get_module_inputs(slot: number, mod_num: number): Promise<Int32Array | null>;
  sv_get_module_outputs(slot: number, mod_num: number): Promise<Int32Array | null>;
  sv_get_module_type(slot: number, mod_num: number): Promise<string>;
  sv_get_module_name(slot: number, mod_num: number): Promise<string>;
  sv_set_module_name(slot: number, mod_num: number, name: string): Promise<number>;
  sv_get_module_xy(slot: number, mod_num: number): Promise<number>;
  sv_set_module_xy(slot: number, mod_num: number, x: number, y: number): Promise<number>;
  sv_get_module_color(slot: number, mod_num: number): Promise<number>;
  sv_set_module_color(slot: number, mod_num: number, color: number): Promise<number>;
  sv_get_module_finetune(slot: number, mod_num: number): Promise<number>;
  sv_set_module_finetune(slot: number, mod_num: number, finetune: number): Promise<number>;
  sv_set_module_relnote(slot: number, mod_num: number, relnote: number): Promise<number>;
  sv_get_module_scope2(slot: number, mod_num: number, channel: number, samples_to_read: number): Promise<BufferResult<Int16Array>>;
  sv_module_curve(slot: number, mod_num: number, curve_num: number, buf_float32: Float32Array, len: number, w: number): Promise<BufferResult<Float32Array>>;
  sv_get_number_of_module_ctls(slot: number, mod_num: number): Promise<number>;
  sv_get_module_ctl_name(slot: number, mod_num: number, ctl_num: number): Promise<string>;
  sv_get_module_ctl_value(slot: number, mod_num: number, ctl_num: number, scaled: number): Promise<number>;
  sv_set_module_ctl_value(slot: number, mod_num: number, ctl_num: number, val: number, scaled: number): Promise<number>;
  sv_get_module_ctl_min(slot: number, mod_num: number, ctl_num: number, scaled: number): Promise<number>;
  sv_get_module_ctl_max(slot: number, mod_num: number, ctl_num: number, scaled: number): Promise<number>;
  sv_get_module_ctl_offset(slot: number, mod_num: number, ctl_num: number): Promise<number>;
  sv_get_module_ctl_type(slot: number, mod_num: number, ctl_num: number): Promise<number>;
  sv_get_module_ctl_group(slot: number, mod_num: number, ctl_num: number): Promise<number>;
  sv_new_pattern(slot: number, clone: number, x: number, y: number, tracks: number, lines: number, icon_seed: number, name: string): Promise<number>;
  sv_remove_pattern(slot: number, pat_num: number): Promise<number>;
  sv_get_number_of_patterns(slot: number): Promise<number>;
  sv_find_pattern(slot: number, name: string): Promise<number>;
  sv_get_pattern_x(slot: number, pat_num: number): Promise<number>;
  sv_get_pattern_y(slot: number, pat_num: number): Promise<number>;
  sv_set_pattern_xy(slot: number, pat_num: number, x: number, y: number): Promise<number>;
  sv_get_pattern_tracks(slot: number, pat_num: number): Promise<number>;
  sv_get_pattern_lines(slot: number, pat_num: number): Promise<number>;
  sv_set_pattern_size(slot: number, pat_num: number, tracks: number, lines: number): Promise<number>;
  sv_get_pattern_name(slot: number, pat_num: number): Promise<string>;
  sv_set_pattern_name(slot: number, pat_num: number, name: string): Promise<number>;
  sv_get_pattern_data(slot: number, pat_num: number): Promise<Uint8Array | null>;
  sv_set_pattern_event(slot: number, pat_num: number, track: number, line: number, nn: number, vv: number, mm: number, ccee: number, xxyy: number): Promise<number>;
  sv_get_pattern_event(slot: number, pat_num: number, track: number, line: number, column: number): Promise<number>;
  sv_pattern_mute(slot: number, pat_num: number, mute: number): Promise<number>;
  sv_get_ticks(): Promise<number>;
  sv_get_ticks_per_second(): Promise<number>;
  sv_get_log(size: number): Promise<string>;
}
export type EngineMethod = keyof EngineMethods;
export type EngineCommand = {
  [K in EngineMethod]: { method: K; args: Parameters<EngineMethods[K]> }
}[EngineMethod];
export interface SunVoxEngine extends EngineMethods {
  initialize(): Promise<{ version: number; sampleRate: number; channels: 2 }>;
  call<K extends EngineMethod>(method: K, ...args: Parameters<EngineMethods[K]>): ReturnType<EngineMethods[K]>;
  /** Runs validated calls without render interleaving. Not a rollback transaction. */
  batch(commands: readonly EngineCommand[]): Promise<unknown[]>;
  /** Interleaved stereo Float32 audio; input, if supplied, uses the same layout. */
  render(frames: number, options?: { input?: Float32Array; latency?: number; time?: number }): Promise<BufferResult<Float32Array>>;
  /** Connect/resume browser output from a user gesture. */
  startAudio(): Promise<void>;
  /** Disconnect output; this does not change any slot's transport state. */
  stopAudio(): Promise<void>;
  getAudioTransportState(): { mode: "message-port" | "shared-array-buffer"; shared: boolean; crossOriginIsolated: boolean };
  dispose(): void;
}
export function createSunVoxEngine(options: EngineOptions): SunVoxEngine;
