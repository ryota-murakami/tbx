import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync('data/tweets.json', 'utf8'));
const translations = fs.existsSync('data/translations.json')
  ? JSON.parse(fs.readFileSync('data/translations.json', 'utf8'))
  : {};
const following = fs.existsSync('data/following.json')
  ? JSON.parse(fs.readFileSync('data/following.json', 'utf8'))
  : [];

// JST で日付を丸める
const jst = ts => {
  const d = new Date(ts + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

const out = items.map(it => ({
  ...it,
  date: jst(it.ts),
  ja: translations[it.id] ?? null,
  quoted: it.quoted ? { ...it.quoted, ja: translations['q:' + it.quoted.id] ?? null } : null,
}));

// 日別集計
const byDate = {};
for (const it of out) byDate[it.date] = (byDate[it.date] ?? 0) + 1;

const payload = {
  generated_at: new Date().toISOString(),
  owner: 'malloc007',
  following_count: following.length,
  following,
  counts: byDate,
  tweets: out,
};

fs.mkdirSync('site', { recursive: true });
fs.writeFileSync('site/data.json', JSON.stringify(payload));
console.log(`site/data.json: ${out.length} tweets, ${(fs.statSync('site/data.json').size / 1e6).toFixed(1)}MB`);
