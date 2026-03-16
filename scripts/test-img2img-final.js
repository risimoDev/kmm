// Тест: какая модель РЕАЛЬНО делает img2img (сохраняет объект, меняет фон)
const https = require('https');
const API_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';
const TEST_IMG = 'https://k-m-m.ru/api/media/public/images/1773493625027-f4dc8eb15ccde8cf.jpg';
const PROMPT = 'Place this exact product on a clean white studio background with professional soft lighting. Keep the product 100% identical — same shape, colors, labels, packaging. Only change the background.';

function makeReq(label, body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'gptunnel.ru', path: '/v1/media/create', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const ok = j.code === 0 ? '✅' : '❌';
          console.log(`${ok} ${label}: code=${j.code} id=${j.id} status=${j.status} ${j.message||''}`);
          resolve(j);
        } catch { console.log(`❌ ${label}: parse error ${data.substring(0,200)}`); resolve(null); }
      });
    });
    req.on('error', e => { console.log(`❌ ${label}: ${e.message}`); resolve(null); });
    req.write(body); req.end();
  });
}

function checkResult(taskId) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'gptunnel.ru', path: '/v1/media/result', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(JSON.stringify({ task_id: taskId })); req.end();
  });
}

(async () => {
  console.log('Testing img2img models...\n');

  const tests = [
    // flux-kontext специально создан для image editing
    ['flux-kontext-pro + image (str)', { model: 'flux-kontext-pro', prompt: PROMPT, image: TEST_IMG }],
    ['flux-kontext-max + image (str)', { model: 'flux-kontext-max', prompt: PROMPT, image: TEST_IMG }],
    // seedream-3 variants
    ['seedream-3 + image (str)', { model: 'seedream-3', prompt: PROMPT, image: TEST_IMG }],
    // gpt-image-1 variants
    ['gpt-image-1-high + image (str)', { model: 'gpt-image-1-high', prompt: PROMPT, image: TEST_IMG }],
    ['gpt-image-1-medium + image (str)', { model: 'gpt-image-1-medium', prompt: PROMPT, image: TEST_IMG }],
    // recraft supports editing
    ['recraftv3 + image (str)', { model: 'recraftv3', prompt: PROMPT, image: TEST_IMG }],
  ];

  const results = [];
  for (const [label, body] of tests) {
    const r = await makeReq(label, JSON.stringify(body));
    if (r?.id) results.push({ id: r.id, label });
    await new Promise(r => setTimeout(r, 300));
  }

  if (!results.length) { console.log('\nNo tasks started!'); return; }

  console.log(`\nWaiting 50s for ${results.length} tasks...\n`);
  await new Promise(r => setTimeout(r, 50000));

  for (const t of results) {
    const res = await checkResult(t.id);
    const ok = res.url ? '✅' : (res.status === 'failed' ? '❌' : '⏳');
    console.log(`${ok} ${t.label}: ${res.status} ${res.url ? '\n   URL: ' + res.url : (res.message||'')}`);
  }
})();
