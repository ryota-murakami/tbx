import { HEADERS, FEATURES, sleep } from './xapi.mjs';
import fs from 'node:fs';

const QUERY_ID = 'eDqlbOS46zda8jDT8dEQ_Q';
const USER_ID = '1664570156';
const GQL = `https://x.com/i/api/graphql/${QUERY_ID}/Following`;

const users = [];
const seen = new Set();
let cursor = null;
let page = 0;

while (page < 200) {
  const variables = { userId: USER_ID, count: 20, includePromotedContent: false, withGrokTranslatedBio: true };
  if (cursor) variables.cursor = cursor;
  const url = `${GQL}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;

  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  if (res.status !== 200) {
    console.error(`status ${res.status}: ${text.slice(0, 200)}`);
    await sleep(10000);
    continue;
  }
  const data = JSON.parse(text);
  const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions ?? [];
  let next = null;
  const before = users.length;
  for (const ins of instructions) {
    for (const e of ins.entries ?? []) {
      if (e.entryId.startsWith('cursor-bottom')) {
        next = e?.content?.value ?? e?.content?.itemContent?.value ?? next;
        continue;
      }
      const u = e?.content?.itemContent?.user_results?.result;
      if (!u || seen.has(u.rest_id)) continue;
      seen.add(u.rest_id);
      users.push({
        id: u.rest_id,
        name: u.core?.name ?? u.legacy?.name ?? '',
        screen_name: u.core?.screen_name ?? u.legacy?.screen_name ?? '',
        avatar: u.avatar?.image_url ?? u.legacy?.profile_image_url_https ?? '',
        bio: u.profile_bio?.description ?? u.legacy?.description ?? '',
        verified: u.is_blue_verified ?? false,
      });
    }
  }
  console.log(`[page ${page}] users=${users.length} cursor=${next ? 'yes' : 'NO'}`);
  if (!next || next === cursor || users.length === before) break;
  cursor = next;
  page++;
  await sleep(1200 + Math.random() * 800);
}

fs.writeFileSync('data/following.json', JSON.stringify(users, null, 1));
console.log(`total following: ${users.length}`);
