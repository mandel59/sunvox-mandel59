# Agent Instructions

- 研究・開発管理は GitHub Issues を基本にする。
- 長期テーマは umbrella issue、具体的な実験・実装・判断は focused issue、直近の優先順位は weekly / short-term plan issue に分ける。
- Issue 本文の先頭に `research:*` や `process:*` などのテキストタグを置き、GitHub labels が足りなくても検索できるようにする。
- Issue には決定、次の作業、再現コマンド、結果要約、成果物へのリンクを残す。長い生ログや一時出力は `var/` に置き、必要な要約だけを Issue に残す。

## Branches and Deployment

- `main` は GitHub Pages のデプロイ対象として扱う。
- `main` に入れる変更は、公開してよいサイト内容、配布物、ドキュメント、品質ゲートを通した実装に限定する。
- デプロイ可否や公開タイミングが決まっていない研究群は `main` に直接積まず、`main` から生やした `research-main` bookmark / branch に集約する。
- `research-main` は deploy-ready ではない研究取りまとめ用ブランチとして扱い、調査メモ、probe、実験用コード、未確定設計を比較・レビューする場所にする。
- focused research branch は Issue 単位で作り、研究継続なら `research-main` に向け、公開・配布できる状態に整理したものだけ `main` に昇格する。
- PR target は目的で分ける。研究継続なら `research-main`、デプロイ対象化なら `main` に向ける。

## Worktrees

- メインワークスペースは状態確認、軽微修正、統合、レビュー向けに使う。
- 並行研究・開発は Issue ごと、またはサブエージェントごとに専用 worktree を切る。
- worktree 名には Issue 番号と短いトピック名を含める。
- 各 worktree では 1 つの主目的だけを持たせる。目的が分かれたら Issue か worktree を分ける。

## Jujutsu

- 作業は小さな作業単位ごとにコミットする。
- コミットには jujutsu (`jj`) を使う。
- 複数行のコミットメッセージが必要な場合は、改行を直接入れず `-m` オプションを複数渡す。
- `main` bookmark は統合済み・デプロイ対象の状態として扱い、研究・開発中の作業 bookmark とは分ける。
