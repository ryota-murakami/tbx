# tbx — X Following Digest

X(旧Twitter)のフォロー中タイムラインを1ヶ月分収集し、日本語翻訳を付与して
閲覧できる静的サイトを生成するパイプライン。カレンダービュー(日付絞り込み)と
デッキビュー(アカウント別カラム・TweetDeck式)を切替可能。用語集は `GLOSSARY.md`。

## 使い方

```bash
cd docs && python3 -m http.server 8321
# → http://localhost:8321
```

## パイプライン

| 順序 | スクリプト | 内容 |
|---|---|---|
| 1 | `scripts/reseed_x_cookies.mjs` | ChromeのCookieを復号し x/twitter 分だけ `data/.x-cookies.json` にキャッシュ(対話実行・長寿命) |
| 2 | `scripts/following.mjs` | フォロー中121アカウント一覧 → `data/following.json` |
| 3 | `scripts/scrape.mjs` | HomeLatestTimeline をカーソルで過去31日分ページネート → `data/raw/*.json` (中断・再開可) |
| 4 | `scripts/normalize.mjs` | 生JSONを正規化(リポスト展開・メディア・引用・エンティティデコード) → `data/tweets.json` |
| 5 | `scripts/translate.mjs` | 非日本語テキストを gpt-4.1-mini で翻訳 → `data/translations.json` (再開可) |
| 6 | `scripts/build_site.mjs` | `docs/data.json` 生成 |

## 自動更新 (launchd)

`~/Library/LaunchAgents/io.tbx.digest-update.plist` で毎朝 8:00 に `scripts/update.sh` を実行。
増分 scrape → 翻訳 → `docs/data.json` 再生成 → 差分があれば commit & push（Pages 自動再デプロイ）。

```bash
# 手動実行
bash scripts/update.sh

# 状態確認 / ログ
launchctl list | grep tbx
tail -20 data/update.log

# 解除
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/io.tbx.digest-update.plist
```

- 失敗時は macOS 通知で知らせる（osascript）。
- launchd 配下では macOS の Chrome データ保護(TCC)で Chrome の Cookie を直接読めないため、`data/.x-cookies.json` キャッシュを使う。auth_token/ct0 は長寿命だが、期限切れで通知が来たら対話セッションで `node scripts/reseed_x_cookies.mjs` を実行すれば再キャッシュされる。
- `data/.env` に `OPENAI_API_KEY=...` が必要（gitignore 対象）。

## 注意

- `scripts/xapi.mjs` は `data/.x-cookies.json` から X のクッキーを読む（gitignore・mode 600 対象）。期限切れなら `node scripts/reseed_x_cookies.mjs` を対話実行。
- 収集対象は「Following」タイムライン = X上で自分に見える範囲(他人宛リプライ等は含まれない)。
- `data/raw*`・`data/*.log`・`data/scrape_state*.json` は gitignore 対象（生成物）。`docs/data.json` は GitHub Pages 配信のためコミット対象（`build_site.mjs` で再生成）。
- `data/tweets.json`・`translations.json`・`following.json` は収集済みデータなのでコミット対象。
- `OPENAI_API_KEY` 必須(翻訳)。`TRANSLATE_MODEL` でモデル変更可。
