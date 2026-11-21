import fs from 'node:fs';

const RAW_DIRS = fs.readdirSync('data').filter(d => d.startsWith('raw')).map(d => `data/${d}`);
const OUT = 'data/tweets.json';

function userOf(result) {
  const u = result?.core?.user_results?.result;
  if (!u) return null;
  return {
    id: u.rest_id ?? '',
    name: u.core?.name ?? u.legacy?.name ?? '',
    screen_name: u.core?.screen_name ?? u.legacy?.screen_name ?? '',
    avatar: u.avatar?.image_url ?? u.legacy?.profile_image_url_https ?? '',
    verified: u.is_blue_verified ?? false,
  };
}

function mediaOf(tw) {
  const list = tw?.legacy?.extended_entities?.media ?? tw?.legacy?.entities?.media ?? [];
  return list.map(m => ({
    type: m.type,
    url: m.media_url_https,
    video: (m.video_info?.variants ?? []).find(v => v.content_type === 'video/mp4')?.url ?? null,
  }));
}

function urlsOf(tw) {
  return (tw?.legacy?.entities?.urls ?? []).map(u => ({
    short: u.url,
    expanded: u.expanded_url,
    display: u.display_url,
  }));
}

// メディア添付の t.co リンクを本文から除去 (X公式クライアントと同じ表示に)
function stripMediaUrls(text, tw) {
  const media = tw?.legacy?.entities?.media ?? tw?.legacy?.extended_entities?.media ?? [];
  for (const m of media) {
    if (m.url) text = text.replaceAll(m.url, '');
  }
  return text.replace(/[ \t]+\n/g, '\n').trimEnd();
}

// X API のテキストに含まれるHTMLエンティティをデコード (&amp; &#39; &lt; 等)
function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', nbsp: ' ' };
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[e] ?? m;
  });
}

// ツイート本文: note_tweet(長文) > full_text
function textOf(tw) {
  const raw =
    tw?.note_tweet?.note_tweet_results?.result?.text ??
    tw?.legacy?.full_text ??
    '';
  return stripMediaUrls(decodeEntities(raw), tw);
}

function innerTweet(result) {
  // リツイート本体を返す
  const rt = result?.legacy?.retweeted_status_result?.result;
  return rt?.tweet ?? rt ?? null;
}

function normalize(result, entryId) {
  const tw = result?.tweet ?? result;
  const legacy = tw?.legacy;
  if (!legacy) return null;

  const author = userOf(tw);
  const rt = innerTweet(tw);
  const isRepost = !!rt;
  const target = rt ?? tw; // 表示対象 = リポストなら元ツイート
  const targetAuthor = isRepost ? userOf(rt) : author;
  const quoted = tw?.quoted_status_result?.result ?? rt?.quoted_status_result?.result ?? null;

  return {
    id: tw.rest_id ?? entryId.replace(/^tweet-/, ''),
    type: isRepost ? 'repost' : 'post',
    created_at: legacy.created_at,
    ts: new Date(legacy.created_at).getTime(),
    user: author,                    // フォロー中のアカウント(リポスト主)
    author: targetAuthor ?? author,  // 本文の著者
    reposted_by: isRepost ? author : null,
    text: textOf(target),
    lang: target?.legacy?.lang ?? legacy.lang ?? '',
    media: mediaOf(target),
    urls: urlsOf(target),
    quoted: quoted
      ? {
          id: quoted.rest_id ?? '',
          author: userOf(quoted),
          text: textOf(quoted),
          lang: quoted?.legacy?.lang ?? '',
        }
      : null,
    stats: {
      likes: target?.legacy?.favorite_count ?? 0,
      reposts: target?.legacy?.retweet_count ?? 0,
      replies: target?.legacy?.reply_count ?? 0,
      views: parseInt(target?.views?.count ?? '0') || 0,
    },
    status_url: `https://x.com/${(targetAuthor ?? author)?.screen_name ?? 'x'}/status/${rt?.rest_id ?? tw.rest_id}`,
  };
}

const files = RAW_DIRS.flatMap(dir =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => `${dir}/${f}`) : []
).sort();
const items = [];
const seen = new Set();

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const instructions = data?.data?.home?.home_timeline_urt?.instructions ?? [];
  for (const ins of instructions) {
    for (const e of ins.entries ?? []) {
      if (!e.entryId?.startsWith('tweet-')) continue;
      const r = e?.content?.itemContent?.tweet_results?.result;
      if (!r) continue;
      const n = normalize(r, e.entryId);
      if (!n || seen.has(n.id)) continue;
      seen.add(n.id);
      items.push(n);
    }
  }
}

items.sort((a, b) => b.ts - a.ts);
fs.writeFileSync(OUT, JSON.stringify(items, null, 1));
const reposts = items.filter(i => i.type === 'repost').length;
const oldest = items[items.length - 1]?.created_at;
console.log(`tweets: ${items.length} (reposts: ${reposts}) oldest: ${oldest}`);
