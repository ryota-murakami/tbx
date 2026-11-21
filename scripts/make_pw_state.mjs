import fs from 'node:fs';

// export-chrome-cookies.mjs の出力から x/twitter のクッキーだけを抽出し、
// xapi.mjs が読む /tmp/pw-state.json 形式で保存する
const data = JSON.parse(fs.readFileSync('/tmp/chrome-pw-cookies.json', 'utf8'));
const x = (data.cookies ?? []).filter(
  c => c.domain?.endsWith('x.com') || c.domain?.endsWith('twitter.com')
);
fs.writeFileSync('/tmp/pw-state.json', JSON.stringify({ cookies: x, origins: [] }));
const names = new Set(x.map(c => c.name));
if (!names.has('auth_token') || !names.has('ct0')) {
  console.error('missing auth cookies:', [...names].join(','));
  process.exit(1);
}
console.log(`pw-state: ${x.length} x/twitter cookies`);
