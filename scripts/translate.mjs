import fs from 'node:fs';

const TWEETS = 'data/tweets.json';
const OUT = 'data/translations.json';
const MODEL = process.env.TRANSLATE_MODEL ?? 'gpt-4.1-mini';
const BATCH = 25;
const CONCURRENCY = 12;

const items = JSON.parse(fs.readFileSync(TWEETS, 'utf8'));
const translations = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

// 翻訳対象テキストを収集 (key -> text)
const todo = new Map();
const hasCJK = s => /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
const meaningful = s => s.replace(/https?:\/\/\S+/g, '').replace(/[\s\p{Emoji}@#]/gu, '').length >= 4;

for (const it of items) {
  if (it.text && it.lang !== 'ja' && meaningful(it.text) && !translations[it.id]) todo.set(it.id, it.text);
  if (it.quoted?.text && it.quoted.lang !== 'ja' && meaningful(it.quoted.text) && !translations['q:' + it.quoted.id])
    todo.set('q:' + it.quoted.id, it.quoted.text);
}

// 日本語っぽいのに lang!=ja のものは翻訳対象から除外(原文=ほぼ日本語)
for (const [k, t] of [...todo]) {
  if (hasCJK(t)) {
    const cjk = (t.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
    const total = t.replace(/\s/g, '').length;
    if (cjk / total > 0.5) todo.delete(k); // 半分以上日本語なら既に日本語
  }
}

console.log(`to translate: ${todo.size}`);
const entries = [...todo.entries()];
const batches = [];
for (let i = 0; i < entries.length; i += BATCH) batches.push(entries.slice(i, i + BATCH));
console.log(`batches: ${batches.length}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let done = 0, failed = 0;

async function translateBatch(batch, attempt = 0) {
  const payload = batch.map(([k, t], i) => ({ i, text: t }));
  const body = {
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a translator for X (Twitter) posts. Translate each text to natural Japanese. ' +
          'Preserve URLs, @mentions, #hashtags, and line breaks. Keep proper nouns/handles in Latin script unless commonly known in Japanese. ' +
          'Do not translate code snippets verbatim-only if they are pure code; add no commentary. ' +
          'Return JSON: {"results":[{"i":0,"ja":"..."}]} with one result per input i.',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    if (attempt < 5 && (res.status === 429 || res.status >= 500)) {
      await sleep(5000 * (attempt + 1));
      return translateBatch(batch, attempt + 1);
    }
    throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  const results = JSON.parse(json.choices[0].message.content).results ?? [];
  for (const r of results) {
    const [k] = batch[r.i] ?? [];
    if (k && typeof r.ja === 'string') translations[k] = r.ja;
  }
}

async function worker() {
  while (batches.length) {
    const b = batches.shift();
    try {
      await translateBatch(b);
      done++;
    } catch (e) {
      failed++;
      console.error('batch failed:', e.message);
    }
    if ((done + failed) % 10 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(translations));
      console.log(`progress: ${done + failed}/${done + failed + batches.length} done=${done} failed=${failed}`);
    }
    await sleep(300);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
fs.writeFileSync(OUT, JSON.stringify(translations));
console.log(`done=${done} failed=${failed} translations=${Object.keys(translations).length}`);
