// https://warmplace.ru/soft/sunvox/sunvox_lib.php
declare function sv_init(config: string, sample_rate: number, channels: number, flags: number): number;
declare function sv_open_slot(slot: number): number;
declare function sv_play_from_beginning(slot: number): number;
declare function sv_stop(slot: number): number;
