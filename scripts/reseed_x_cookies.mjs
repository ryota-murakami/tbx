import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Chrome Cookie を復号エクスポートし、x/twitter 分だけを data/.x-cookies.json にキャッシュする。
// launchd 配下では macOS の Chrome データ保護(TCC)により export は失敗するのが通例なので、
// 期限切れ時は対話セッションで手動実行する。update.sh からも試行され、成功すればキャッシュが自動更新される。

const EXPORTER = `${process.env.HOME}/.agents/skills/cookie/scripts/export-chrome-cookies.mjs`;
const CACHE = new URL('../data/.x-cookies.json', import.meta.url).pathname;
const TMP_JSON = '/tmp/chrome-pw-cookies.json';
const TMP_LOADER = '/tmp/chrome-load-cookies.js';

// 1) 全 Cookie 復号 export (対話実行では許可済みコンテキストで成功する)
execFileSync(process.execPath, [EXPORTER], { stdio: 'pipe' });

// 2) x/twitter 分だけ抽出してキャッシュ (他サイトのトークンは残さない)
const data = JSON.parse(fs.readFileSync(TMP_JSON, 'utf8'));
const x = (data.cookies ?? []).filter(
  c => c.domain?.endsWith('x.com') || c.domain?.endsWith('twitter.com')
);
const names = new Set(x.map(c => c.name));
if (!names.has('auth_token') || !names.has('ct0')) {
  console.error('missing auth cookies:', [...names].join(','));
  process.exit(1);
}
fs.writeFileSync(CACHE, JSON.stringify({ cookies: x, origins: [] }), { mode: 0o600 });

// 3) 平文の一時ファイルは即削除 (全セッションのトークンを含むため)
for (const f of [TMP_JSON, TMP_LOADER]) {
  try { fs.unlinkSync(f); } catch {}
}

console.log(`x-cookies cache: ${x.length} cookies → ${CACHE}`);
