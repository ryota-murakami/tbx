#!/bin/bash
# tbx X Following Digest - 日次増分更新
# Chrome Cookie 再エクスポート → 増分 scrape → normalize → translate → build → commit & push
# launchd (~/Library/LaunchAgents/io.tbx.digest-update.plist) から毎朝 8:00 に呼ばれる想定
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# node解決: 対話シェルの mise shim は非対話環境でバージョン解決できないため実バイナリを使う
NODE_BIN=""
for c in \
  "$HOME/.local/share/mise/installs/node/lts/bin/node" \
  "$HOME/.local/share/mise/installs/node/latest/bin/node" \
  /opt/homebrew/bin/node \
  "$(command -v node 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && "$c" --version >/dev/null 2>&1 && NODE_BIN="$c" && break
done
if [ -z "$NODE_BIN" ]; then
  # 最終手段: installs 配下の最大バージョン
  NODE_BIN=$(find "$HOME/.local/share/mise/installs/node" -maxdepth 3 -name node -type f 2>/dev/null | sort -V | tail -1)
fi
[ -n "$NODE_BIN" ] || { echo "node not found"; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1
LOG="$REPO/data/update.log"
LOCK="$REPO/data/.update.lock"
mkdir -p data

notify() {
  osascript -e "display notification \"$1\" with title \"tbx X Digest\"" 2>/dev/null || true
}
fail() {
  echo "$(date '+%F %T') ERROR: $1" >> "$LOG"
  notify "更新失敗: $1"
  exit 1
}

# 多重起動防止 (前回の実行が残っていたら何もしない)
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') skip: already running" >> "$LOG"
  exit 0
fi
trap 'rm -rf "$LOCK"' EXIT

echo "=== $(date '+%F %T') start ===" >> "$LOG"

# 環境変数 (OPENAI_API_KEY)
if [ -f data/.env ]; then set -a; . data/.env; set +a; fi
[ -n "${OPENAI_API_KEY:-}" ] || fail "OPENAI_API_KEY 未設定 (data/.env)"

# 1. Chrome Cookie → /tmp/pw-state.json (x.com 分のみ)
"$NODE_BIN" "$HOME/.agents/skills/cookie/scripts/export-chrome-cookies.mjs" >> "$LOG" 2>&1 || fail "cookie export"
"$NODE_BIN" scripts/make_pw_state.mjs >> "$LOG" 2>&1 || fail "pw-state"
rm -f /tmp/chrome-load-cookies.js /tmp/chrome-pw-cookies.json

# 2. 既存データの最大時刻 - 2h を増分打ち切りしきい値に
STOP_TS=$("$NODE_BIN" -e 'try{const i=JSON.parse(require("fs").readFileSync("data/tweets.json","utf8"));console.log(Math.max(...i.map(t=>t.ts))-2*3600e3)}catch(e){console.log(0)}')

# 3. 次の raw ディレクトリ (raw, raw2, raw3, ...)
N=$(find data -maxdepth 1 -type d -name 'raw*' | wc -l | tr -d ' ')
RAW="data/raw$((N + 1))"

# 4. 増分 scrape
env RAW_DIR="$RAW" STATE_FILE="data/.scrape_state_inc.json" STOP_BEFORE_TS="$STOP_TS" \
  "$NODE_BIN" scripts/scrape.mjs >> "$LOG" 2>&1 || fail "scrape"

# 5. 正規化 → 翻訳 → サイト生成
"$NODE_BIN" scripts/normalize.mjs >> "$LOG" 2>&1 || fail "normalize"
"$NODE_BIN" scripts/translate.mjs >> "$LOG" 2>&1 || fail "translate"
"$NODE_BIN" scripts/build_site.mjs >> "$LOG" 2>&1 || fail "build_site"

# 6. commit & push (変更があるときだけ → GitHub Pages が自動再デプロイ)
git add -A
if git diff --cached --quiet; then
  echo "$(date '+%F %T') no changes" >> "$LOG"
else
  git commit -m "chore: daily timeline update $(date '+%F')" >> "$LOG" 2>&1 || fail "git commit"
  git push >> "$LOG" 2>&1 || fail "git push"
  echo "$(date '+%F %T') committed & pushed" >> "$LOG"
fi

echo "=== $(date '+%F %T') done ===" >> "$LOG"
