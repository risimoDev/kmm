// Live test: seedream-3 с реальным фото с нашего сервера
const https = require('https');
const API_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';
const TEST_IMG = 'https://k-m-m.ru/api/media/public/images/1773493625027-f4dc8eb15ccde8cf.jpg';

function makeReq(label, body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'gptunnel.ru',
      path: '/v1/media/create',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`\n=== ${label} ===`);
        console.log(`HTTP: ${res.statusCode}`);
        try {
          const j = JSON.parse(data);
          console.log(`code: ${j.code}, id: ${j.id}, status: ${j.status}`);
          if (j.code !== 0) console.log(`ERROR MSG: ${j.message || JSON.stringify(j)}`);
          resolve(j);
        } catch { console.log(`RAW: ${data.substring(0, 400)}`); resolve(null); }
      });
    });
    req.on('error', e => { console.log(`ERR: ${e.message}`); resolve(null); });
    req.write(body);
    req.end();
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
    req.write(JSON.stringify({ task_id: taskId }));
    req.end();
  });
}

(async () => {
  console.log('=== Live test seedream-3 img2img с реальным URL ===\n');

  // Test 1: seedream-3 + images[] (как в docs)
  const r1 = await makeReq('seedream-3 + images=[]', JSON.stringify({
    model: 'seedream-3',
    prompt: 'Professional product photo on white studio background',
    images: [TEST_IMG]
  }));

  // Test 2: seedream-3 + image= (string)
  const r2 = await makeReq('seedream-3 + image= (string)', JSON.stringify({
    model: 'seedream-3',
    prompt: 'Professional product photo on white studio background',
    image: TEST_IMG
  }));

  // Test 3: flux-kontext-max (premium edit model, $16)
  const r3 = await makeReq('flux-kontext-max + images=[]', JSON.stringify({
    model: 'flux-kontext-max',
    prompt: 'Professional product photo on white studio background. Keep the product EXACTLY as shown.',
    images: [TEST_IMG]
  }));

  // Test 4: flux-kontext-pro + images[]
  const r4 = await makeReq('flux-kontext-pro + images=[]', JSON.stringify({
    model: 'flux-kontext-pro',
    prompt: 'Professional product photo on white studio background. Keep the product EXACTLY as shown.',
    images: [TEST_IMG]
  }));

  // Test 5: gpt-image-1-high + images[]
  const r5 = await makeReq('gpt-image-1-high + images=[]', JSON.stringify({
    model: 'gpt-image-1-high',
    prompt: 'Professional product photo on white studio background',
    images: [TEST_IMG]
  }));

  console.log('\n--- Waiting 40s for results ---');
  await new Promise(r => setTimeout(r, 40000));

  const allTasks = [
    ...(r1?.id ? [{ id: r1.id, label: 'seedream-3 + images[]' }] : []),
    ...(r2?.id ? [{ id: r2.id, label: 'seedream-3 + image= string' }] : []),
    ...(r3?.id ? [{ id: r3.id, label: 'flux-kontext-max + images[]' }] : []),
    ...(r4?.id ? [{ id: r4.id, label: 'flux-kontext-pro + images[]' }] : []),
    ...(r5?.id ? [{ id: r5.id, label: 'gpt-image-1-high + images[]' }] : []),
  ];

  for (const t of allTasks) {
    const res = await checkResult(t.id);
    console.log(`\n=== ${t.label} ===`);
    console.log(`Status: ${res.status}, URL: ${res.url || 'none'}`);
    if (res.status === 'failed' || res.status === 'fail') console.log(`Fail msg: ${res.message || JSON.stringify(res)}`);
  }
})();
