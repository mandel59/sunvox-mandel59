# @mandel59/sunvox-synth

`@mandel59/sunvox-web` を利用する独立したブラウザー用シンセサイザー。
既存サイトのページ・プレイヤー・楽曲・音色ファイルには依存しません。

## 起動

リポジトリルートから:

```sh
npm install
# ランタイムが未配置の場合
sh scripts/install_sunvox_lib.sh
npm run dev --workspace @mandel59/sunvox-synth
```

表示された localhost の URL を開き、「音声を開始」を押します。

- 画面の鍵盤をマウス・タッチで演奏。複数タッチ・キー同時押しで和音。
- 41平均律のアイソモーフィック鍵盤。右へ24段、Z→Sの斜め方向へ13段。41段で折り返します。
  数字・Q・A・Zの4行を使い、全キーを基準音から1オクターブ内に配置。
- オクターブ切替、全音停止、画面から離れたときの発音解除。
- FMX と Filter の全コントローラーをネイティブ値で編集。
  波形などの列挙値も現段階では数値表示。
- 出力波形表示・音量調整・モジュール構成と設定の .sunvox 保存。
  保存したファイルは SunVox で開けます。演奏の録音やパターン作成ではありません。

## 41EDO のキー配置

| 行 | 左端の段番号 | 右隣への加算（41で折り返す） |
| --- | ---: | ---: |
| 1 2 3 … | 8 | +24 |
| Q W E … | 19 | +24 |
| A S D … | 30 | +24 |
| Z X C … | 0 | +24 |

- 横: Z → X → C → V → B = 0 → 24 → 7 → 31 → 14。
- 斜め: Z → S → E → 4 = 0 → 13 → 26 → 39。
- 同じ列を上へ移動すると−11段（41を法として+30段）。

段番号は常に0～40へ折り返し、表示・実際の発音の両方に適用します。
Z は既定で C4（約261.626Hz、A4=440Hzから算出）。
基準音をC2～C6へ切り替えられます。
45キーに37種類のピッチクラスが入り、+1・+18・+25・+35のクラスは含みません。
画面ラベルはUS配列表記、PC入力は物理位置を使います。
JIS配列などでは記号キーの印字が異なる場合があります。
フォーム操作・修飾キー付きショートカット・IME変換中は演奏キーを奪いません。

FMXの初期音色は Scratch FMX Tines。全119コントローラーを元の音色に合わせ、
Polyphonyも初期値10にしています。表示は実ボイス数ではなく押下数です。
Polyphonyを変更すると一度全音を停止します。上限を下げた場合の
ボイス奪取とRelease中の余韻はFMXに従います。
発音には `NOTECMD_SET_PITCH` を使います。画面のHzは目標周波数で、
FMX内部の音高量子化による誤差は残ります。
.sunvox保存は音色のみで、鍵盤配置・選択オクターブは含みません。

## 単独ビルド

```sh
npm run build --workspace @mandel59/sunvox-synth
npm run preview --workspace @mandel59/sunvox-synth
```

`packages/sunvox-synth/dist/` の全体を HTTPS の静的サーバーで配信できます。
相対ベース URL によりサブディレクトリへの配置にも対応します。
既存サイトのビルド・デプロイとは別です。

起動・ビルド前に `scripts/prepare-runtime.mjs` がリポジトリの
`sunvox_lib/sunvox_lib/js/lib/` の3ファイルと `docs/license/` を
無視対象の `public/sunvox_lib/` にコピーします。
外部ランタイムを使う場合は `SUNVOX_LIB_DIR` に
`js/lib/` と `docs/license/` を含むディレクトリを指定します。
ランタイムがない場合は明示的に失敗します。

開発サーバーは cross-origin isolation ヘッダーを返します。
配信先でも設定すれば SharedArrayBuffer を使い、
設定しなくても MessagePort 方式で動作します。

## 構成

- Vite + 標準 DOM API。アプリのエントリーは `src/main.js`。
- `createSunVoxEngine()` で1つの Worker/音声出力を所有。
- スロット0に FMX → Filter → Output を作成。
- 各押下元に別トラックを割り当て、非同期 `sv_send_event()` で発音・消音。
- コントローラーの名前・範囲・現在値を Engine から取得して UI を生成。
- `sv_get_module_scope2()` で波形、`sv_save_to_memory()` で保存。
- Player は使いません。URL の楽曲再生・音色キャッシュが不要なためです。

## 確認

リポジトリのブラウザーテスト依存をインストール後:

```sh
npm run build --workspace @mandel59/sunvox-synth
node tools/browser-debug/check-synth-app.mjs
node tools/browser-debug/check-synth-app.mjs --isolation
```

## ライセンス

Powered by SunVox (modular synth & tracker)
Copyright (c) 2008 - 2026, Alexander Zolotov <nightradio@gmail.com>, WarmPlace.ru

ランタイムのライセンスと第三者通知はビルド成果物の
`sunvox_lib/license/` に同梱し、画面からリンクしています。
アプリは private な開発用 workspace パッケージで、npm 公開は行いません。

## 設計検討

- [微分音鍵盤と同一モジュール内の独立発音](docs/microtonal-design.md)

初期音色は `generated/instruments/Scratch FMX Tines.sunsynth` のコピーを
`assets/scratch-fmx-tines.sunsynth` に同梱しています。コントローラーAPI経由の
値の丸めを避け、元の全119パラメーターを維持します。既存サイトへの実行時依存はありません。
