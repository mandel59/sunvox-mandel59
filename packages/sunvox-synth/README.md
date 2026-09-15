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
- PC キー A W S E D F T G Y H U J K が C から次の C に対応。
- オクターブ切替、全音停止、画面から離れたときの発音解除。
- Generator と Filter の全コントローラーをネイティブ値で編集。
  波形などの列挙値も現段階では数値表示。
- 出力波形表示・音量調整・モジュール構成と設定の .sunvox 保存。
  保存したファイルは SunVox で開けます。演奏の録音やパターン作成ではありません。

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
- スロット0に Generator → Filter → Output を作成。
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
