// https://warmplace.ru/soft/sunvox/sunvox_lib.php
declare var svlib: any;
declare var sda_ctx: AudioContext | undefined;

declare function sv_init(config: string | 0 | null, sample_rate: number, channels: number, flags: number): number;
declare function sv_open_slot(slot: number): number;
declare function sv_close_slot(slot: number): number;
declare function sv_lock_slot(slot: number): number;
declare function sv_unlock_slot(slot: number): number;
declare function sv_load_from_memory(slot: number, byte_array: Uint8Array): number;
declare function sv_play(slot: number): number;
declare function sv_play_from_beginning(slot: number): number;
declare function sv_stop(slot: number): number;
declare function sv_volume(slot: number, volume: number): number;
declare function sv_connect_module(slot: number, source: number, destination: number): number;
declare function sv_load_module_from_memory(slot: number, byte_array: Uint8Array, x: number, y: number, z: number): number;
declare function sv_set_module_ctl_value(
  slot: number,
  mod_num: number,
  ctl_num: number,
  value: number,
  scaled: number,
): number;
declare function sv_send_event(
  slot: number,
  track: number,
  note: number,
  velocity: number,
  module: number,
  controller: number,
  value: number,
): number;
