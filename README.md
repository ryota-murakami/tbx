# tbx — X Following Digest

X(旧Twitter)のフォロー中タイムラインを1ヶ月分収集し、日本語翻訳を付与して
カレンダーUIで閲覧できる静的サイトを生成するパイプライン。

## 使い方

```bash
cd docs && python3 -m http.server 8321
# → http://localhost:8321
```

## パイプライン

| 順序 | スクリプト | 内容 |
|---|---|---|
| 1 | (cookie skill) | Chromeのクッキーをplaywright-cliにロード → `playwright-cli state-save /tmp/pw-state.json` |
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
- `data/.env` に `OPENAI_API_KEY=...` が必要（gitignore 対象）。

## 注意

- `scripts/xapi.mjs` は `/tmp/pw-state.json` から X のクッキーを読む。期限切れなら cookie skill で再エクスポート。
- 収集対象は「Following」タイムライン = X上で自分に見える範囲(他人宛リプライ等は含まれない)。
- `data/raw*`・`data/*.log`・`data/scrape_state*.json` は gitignore 対象（生成物）。`docs/data.json` は GitHub Pages 配信のためコミット対象（`build_site.mjs` で再生成）。
- `data/tweets.json`・`translations.json`・`following.json` は収集済みデータなのでコミット対象。
- `OPENAI_API_KEY` 必須(翻訳)。`TRANSLATE_MODEL` でモデル変更可。
