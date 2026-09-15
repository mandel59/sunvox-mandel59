# 微分音鍵盤と同一モジュール内の独立発音

Issue: [#70](https://github.com/mandel59/sunvox-mandel59/issues/70)

## 結論

現在の Generator → Filter → Output 構成で、同じ Generator に異なる微分音を
同時に送れる。音ごとに別トラックを割り当てれば、片方だけの消音・ベンドも可能。
音ごとに Generator や Engine を増やす必要はない。

今回は API・実音声の検証と設計整理を行った。アプリの12音鍵盤 UI は変更していない。

## 音高と音の識別子を分ける

SunVox Lib の `NOTECMD_SET_PITCH = 133` は、イベント最後の引数で細かい音高を指定する。
`moduleNumber + 1` を指定した通常の SET_PITCH は発音イベントになる。

```js
const pitch = Math.round(
  30720 - Math.log2(frequencyHz / 16.333984375) * 3072
);
await engine.sv_send_event(
  slot, track, NOTECMD_SET_PITCH, velocity, moduleNumber + 1, 0, pitch
);
await engine.sv_send_event(slot, track, NOTECMD_NOTE_OFF, 0, 0, 0, 0);
```

音高の値は高い音ほど小さくなる。公称範囲は 0x0000..0x7800。
範囲外や不正な周波数はアプリで拒否する。
1半音は256単位、イベント形式の分解能は **0.390625セント**。
これは発振器の実際の精度を保証しない。

出典: [SunVox Lib — sv_send_event / Constants](https://www.warmplace.ru/soft/sunvox/sunvox_lib.php)

現在の `held: Map<押下元, { offset, track }>` はそのまま発展させられる。
音のIDに丸めた半音番号を使わず、押下元とトラックを使うことが重要。
同じ半音に属する微分音や、全く同じ音高の2音も、別トラックなら個別に消音できる。

## 「チャンネル」の区別

| 要素 | 役割 | 今回の関係 |
| --- | --- | --- |
| トラック | イベントの送り先を識別し、最後に鳴らした音を保持 | 押下中の各音に別番号を割り当てる |
| モジュールの Polyphony | 内部の同時発音数 | Generator の初期値は8。32トラック割当とは別の上限 |
| モノ／ステレオ | PCM の音声チャンネル数 | モノでも複数の微分音を同時に保持できる |
| モジュールのグローバル設定 | 全体に対する音色設定 | 現在のコントローラースライダーはこちら |
| ローカルコントローラー | 対応モジュールの特定ボイスだけを操作 | Generator では波形・パンなど。全設定が対応するわけではない |

モジュール内部のボイス番号をアプリが直接指定する仕組みではない。
トラック由来のイベントIDに対応するボイスをモジュールが選び、操作する。

実装参照:
- `var/sunvox_lib/lib_sunvox/sunvox_engine_audio_callback.cpp`: イベントIDと SET_PITCH の処理。
- `var/sunvox_lib/lib_sunvox/psynth/psynths_generator.cpp`: NOTE_ON のボイス割当、
  SET_FREQ／NOTE_OFF のID照合、ローカルコントローラー。
- [SunVox manual — Generator / Local controllers](https://www.warmplace.ru/soft/sunvox/manual.php)

## 発音後の音高変更

押下時は SET_PITCH で発音する。押したまま音を曲げたい場合、
通常の SET_PITCH を繰り返すと再発音になるため、ベンドと区別する。

今回検証した方法は、そのトラックに effect 05/06 を送るもの。
発音時の音高を基準としたオフセットであり、前回のベンドからの加算ではない。

```js
// track の音だけを50セント上げる。module=0、note=0。
await engine.sv_send_event(slot, track, 0, 0, 0, 0x05, 128);
// 発音時の音高へ戻す。
await engine.sv_send_event(slot, track, 0, 0, 0, 0x05, 0);
```

ローカルパンも独立操作できる。Generator の Panning はコントローラー番号3なので、
`ctl = 3 << 8`、module=0、note=0 でトラックの既存ボイスへ送る。
`sv_set_module_ctl_value()` はグローバル設定用であり、音ごとの制御には使わない。

## 共有 Filter の制約

Generator 内部では音ごとの音高・音量包絡などを処理し、混ぜた PCM を Filter に送る。
そのため、現在の共有 Filter のカットオフは全音に作用する。
微分音の和音そのものには問題ないが、音ごとに異なるフィルター包絡が必要なら別設計になる。

選択肢:
1. Analog Generator の内部フィルターと対応ローカルコントローラーを使う。
2. 音ごとに Generator → Filter の枝を作ってミックスする。

後者にはボイスの割当・奪取・余韻・音色設定の複製の管理が必要。
微分音を鳴らすだけの初期実装には追加しない。

## 実験結果

`tools/browser-debug/probe-microtonal.mjs` はブラウザーで公開 Engine API を使い、
Worker 内の SunVox WASM をオフラインレンダリングする。
44.1kHz・ステレオ Float32、Generator は正弦波、Attack/Release=0、
Sustain=1、Polyphony=8、Filter は初期設定。
リアルタイムの操作遅延や音切れを測る実験ではない。

| 実験 | 結果 |
| --- | --- |
| 440Hz と 440 × 2^(1/31) ≈ 449.949Hz を別トラックへ送信 | 両周波数成分を検出 |
| トラック0だけ50セント上げる | 曲げた音と、変更していないトラック1の音を検出 |
| トラック0だけ NOTE_OFF | トラック1が残る |
| 両トラック NOTE_OFF | 無音 |
| Generator の Mode=mono で上記を繰り返す | 同じ独立性を維持 |
| 同じ周波数を2トラックに送って片方を離す | もう片方が残る |
| 各音をローカルパンで左右へ振る | 周波数成分を左右に分離 |
| Polyphony=1 で2トラックに順次発音 | 後の音が残り、先の音は奪取される |
| 奪取された古い音のトラックへ NOTE_OFF | 新しい音は止まらない |

Generator の周波数丸めも確認した。pitch を16124から16127へ1ずつ変えても、
いずれも約439.8325Hzと測定された。参照ソースでも周波数計算前に
`event->note.pitch / 4` があり、イベントの全256段階をそのまま使うわけではない。
4 pitch単位は1.5625セント。周波数テーブル等の誤差もあるため、
「0.39セント精度の発振器」とは説明しない。

440Hz要求を整数pitchへ丸めた理論値は約440.0222Hz、
Generatorの実測は約440.2531Hzだった。
この差はトラックの独立性とは別の問題。
厳密な調律や非常に近い2音のうなりを狙う場合は、モジュール別の精度検証が必要。
Analog Generator の Increased frequency computation accuracy は今後の候補だが、
この実験では検証していない。

再現:
```sh
node tools/browser-debug/probe-microtonal.mjs
```

ランタイム、Vite、ブラウザーテスト依存の準備は既存の Engine テストと同じ。
測定JSONは `var/microtonal-probe/results.json`。
周波数成分は1秒のPCMに Hann 窓をかけて評価し、単音の周波数は
補間したゼロ交差から推定する。閾値を超えない場合は非ゼロ終了する。

## 鍵盤の実装案

1. **鍵盤位置 → 調律上の周波数 → SunVox pitch** を分離する。
   N平均律なら `frequency = referenceHz * 2 ** (step / N)`。
   12／19／24／31／43平均律などを選べる形で始め、任意セント・比率表へ拡張可能にする。
2. 12音以外は白鍵／黒鍵の意味を固定せず、等幅の段数グリッドを使う。
   基準音・オクターブ・段番号・周波数を表示し、PCキーも段番号へ対応付ける。
3. 押下元に `{ track, step, basePitch }` を保持し、消音には保存した track を使う。
   調律やオクターブ切替時は、まず全音を停止する。
4. Generator の Polyphony とアプリ側トラック上限32の両方を考慮する。
   現状の VOICES 表示は押下数で、実際の発音ボイス数ではない。
   上限超過を拒否するか古い音を奪取するかをUIと合わせて決める。
   Release中の余韻も内部ボイスを消費する点に注意する。
5. `sunvox-web` の新しい低レベルAPIは不要。まずアプリ側で調律と鍵盤を追加する。
   音ごとのフィルター制御や高精度発振器への変更は別の検討項目にする。

現在の .sunvox 保存はモジュール構成と設定のみ。
鍵盤のEDO・基準周波数はアプリの状態なので、自動ではファイルに保存されない。
微分音鍵盤の実装時には、調律設定の保存方法も明示する。

## 追試: Analog Generator と FMX の調律精度

同じ probe に3種類のモジュール比較を追加した。SunVox Lib 2.1.4、
44.1kHz、単一正弦波、変調なしで pitch=16123..16130 を1ずつ送信。

**基準音高の刻みは同じだが、その後の計算精度は異なる。**

| モジュール／設定 | pitch=16124 の実測 | pitch=16124..16127 |
| --- | --- | --- |
| Generator | 439.8325Hz | 4指定とも同じ周波数 |
| Analog Generator / accuracy off | 439.8325Hz | 同上 |
| Analog Generator / accuracy on | 439.8956Hz | 同上 |
| FMX / 1:1 carrier | 439.9219Hz | 同上 |

pitch=16124 の公称式による値は439.9229Hz。
これは4で割り切れる比較点で、入力pitchの切り捨ての影響を分離しやすい。
この点では FMX が公称値に最も近い。ただし単一周波数付近での結果であり、
全音域の誤差上限ではない。

参照ソース:
- Generator: `psynths_generator.cpp` は pitch / 4 と通常の DELTA 計算。
- Analog Generator: `psynths_generator2.cpp` の
  `gen2_subchannel_set_pitch()` は pitch / 4 を**精度設定によらず**行う。
  accuracy オンでは `PSYNTH_GET_DELTA64_HQ` に切り替わる。
- FMX: `psynths_fm2.cpp` の `gen_channel_recalc_pitch()` も pitch / 4。
  さらに周波数テーブルを3オクターブ上の値で参照し、HQの DELTA 計算を行う。
  オペレーターの周波数倍率は別段階で掛かる。
- `psynth.h` の通常版 DELTA マクロは下位2bitを切り捨てるが、HQ版は保持する。

Analog Generator の精度オプションは `sv_send_event(..., module+1, 0x7200, 1)`
で有効にした。Osc2 の表示上の0は内部値1000なので、それを指定して副発振を無効化。
FMX はコントローラーが「パラメーター種別 → オペレーター」の順に並ぶ点に注意し、
第5オペレーターだけを正弦波・周波数倍率1000で発音した。

[公式マニュアル](https://www.warmplace.ru/soft/sunvox/manual.php)にも Analog Generator の
“Increased frequency computation accuracy” が記載されている。
この設定でも基準音高が1/256半音刻みになるわけではなく、
3種類とも実測では4 pitch単位（1/64半音、1.5625セント）のグループを区別できなかった。

前節の「Analog Generator の精度オプションは未検証」という記述は初回検討時点のもの。
この追試により、精度オプションの効果と、それでも残る音高量子化を確認した。
