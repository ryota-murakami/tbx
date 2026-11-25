import { gqlPost, sleep, FEATURES, HEADERS } from './xapi.mjs';
import fs from 'node:fs';

const RAW_DIR = process.env.RAW_DIR ?? 'data/raw';
fs.mkdirSync(RAW_DIR, { recursive: true });

const STATE_FILE = process.env.STATE_FILE ?? 'data/scrape_state.json';
// 増分モード: ページ内の実ツイートがすべてこのtsより古ければ打ち切る
const STOP_BEFORE_TS = process.env.STOP_BEFORE_TS ? Number(process.env.STOP_BEFORE_TS) : null;
const QUERY_ID = 'IVA5BUbeYPTrpYekQH7jiA';
const OP = 'HomeLatestTimeline';
const CUTOFF_MS = Date.now() - 31 * 24 * 3600 * 1000; // ~1 month
const MAX_PAGES = 1200;

const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { cursor: null, page: 0, done: false };

function parseEntries(data) {
  const instructions = data?.data?.home?.home_timeline_urt?.instructions ?? [];
  let entries = [];
  for (const ins of instructions) {
    if (ins.type === 'TimelineAddEntries') entries = entries.concat(ins.entries);
    if (ins.type === 'TimelineReplaceEntry' && ins.entry?.content?.entryType === 'TimelineTimelineCursor')
      entries.push(ins.entry);
  }
  return entries;
}

function tweetTime(entry) {
  const r = entry?.content?.itemContent?.tweet_results?.result;
  const tw = r?.tweet ?? r;
  const ca = tw?.legacy?.created_at;
  return ca ? new Date(ca).getTime() : null;
}

function bottomCursor(entries) {
  for (const e of entries) {
    const c = e.content;
    if (c?.entryType === 'TimelineTimelineCursor' && c.cursorType === 'Bottom') return c.value;
    if (c?.entryType === 'TimelineTimelineItem' && c.itemContent?.itemType === 'TimelineTimelineCursor' &&
        c.itemContent.value && e.entryId?.includes('cursor-bottom')) return c.itemContent.value;
  }
  return null;
}

let { cursor, page } = state;
let consecutiveErrors = 0;
let okPages = 0;
let sawAuthError = false;

while (page < MAX_PAGES) {
  const file = `${RAW_DIR}/page_${String(page).padStart(4, '0')}.json`;
  if (!fs.existsSync(file)) {
    const variables = {
      count: 40,
      includePromotedContent: true,
      requestContext: cursor ? 'fetch' : 'launch',
    };
    if (cursor) variables.cursor = cursor;

    let res;
    try {
      res = await gqlPost(QUERY_ID, OP, variables);
    } catch (e) {
      console.error(`[page ${page}] network error: ${e.message}`);
      res = { status: -1, text: '' };
    }

    if (res.status !== 200) {
      if (res.status === 401 || res.status === 403) sawAuthError = true;
      consecutiveErrors++;
      const wait = Math.min(60000, 5000 * consecutiveErrors ** 2);
      console.error(`[page ${page}] status ${res.status} (x${consecutiveErrors}), waiting ${wait}ms`);
      if (consecutiveErrors >= 8) { console.error('too many errors, stopping'); break; }
      await sleep(wait);
      continue;
    }

    fs.writeFileSync(file, res.text);
  }

  okPages++;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = parseEntries(data);
  // cutoff判定は実ツイート(tweet-*)のみ — promoted/who-to-follow は古い日付が混ざる
  const times = entries.filter(e => e.entryId.startsWith('tweet-')).map(tweetTime).filter(Boolean);
  const oldest = times.length ? Math.min(...times) : null;
  const newest = times.length ? Math.max(...times) : null;
  const next = bottomCursor(entries);

  console.log(
    `[page ${page}] entries=${entries.length} oldest=${oldest ? new Date(oldest).toISOString() : '-'} ` +
    `newest=${newest ? new Date(newest).toISOString() : '-'} cursor=${next ? 'yes' : 'NO'}`
  );

  if (!next || next === cursor) { console.log('no/repeated cursor → done'); break; }
  cursor = next;
  page++;
  fs.writeFileSync(STATE_FILE, JSON.stringify({ cursor, page, done: false }));
  consecutiveErrors = 0;

  if (STOP_BEFORE_TS && newest && newest < STOP_BEFORE_TS) {
    console.log(`incremental: all tweets older than ${new Date(STOP_BEFORE_TS).toISOString()} → done`);
    break;
  }
  if (oldest && oldest < CUTOFF_MS) {
    console.log(`reached cutoff ${new Date(CUTOFF_MS).toISOString()} → done`);
    break;
  }
  await sleep(1200 + Math.random() * 800);
}

if (okPages === 0) {
  if (sawAuthError) {
    console.error('auth error (401/403): cookies expired — run: node scripts/reseed_x_cookies.mjs');
    process.exit(2);
  }
  console.error('no pages fetched');
  process.exit(1);
}

fs.writeFileSync(STATE_FILE, JSON.stringify({ cursor, page, done: true }));
console.log(`finished at page ${page}`);
