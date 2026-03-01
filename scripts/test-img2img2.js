// Доп.тесты: gpt-image-1-medium + проверка качества
const https = require('https');
const API_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';
const TEST_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/800px-Red_Apple.jpg';

// Тест: gpt-image-1-medium с image (string) - вертикальный
const test = JSON.stringify({
  model: 'gpt-image-1-medium',
  prompt: 'Edit this product photo: place it on clean white studio background. Add professional marketplace infographic elements around the product - feature callout badges, quality icons, subtle gradient accent. The product itself must remain UNCHANGED and photorealistic. Vertical layout.',
  image: TEST_IMAGE,
  ar: '9:16'
});

// Тест: flux-kontext-pro с image (string, не array)
const test2 = JSON.stringify({
  model: 'flux-kontext-pro',
  prompt: 'Place this product on a clean studio background. Add infographic callouts. Vertical layout. Keep product unchanged.',
  image: TEST_IMAGE
});

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
        try {
          const j = JSON.parse(data);
          console.log(`Code: ${j.code}, ID: ${j.id}, Status: ${j.status}`);
          resolve(j);
        } catch { console.log(`Raw: ${data.substring(0, 300)}`); resolve(null); }
      });
    });
    req.on('error', e => { console.log(`ERR: ${e.message}`); resolve(null); });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('--- Sending new requests ---');
  const [r1, r2] = await Promise.all([
    makeReq('gpt-image-1-medium + image (string) + ar 9:16', test),
    makeReq('flux-kontext-pro + image (string, not array)', test2)
  ]);
  
  console.log('\n--- Waiting 30s for results ---');
  await new Promise(r => setTimeout(r, 30000));
  
  // Check all - old and new
  const allTasks = [
    { id: '69a4c6590a686300013b7910', label: 'flux-kontext-pro + images[] (OLD)' },
    ...(r1 ? [{ id: r1.id, label: 'gpt-image-1-medium + image string (NEW)' }] : []),
    ...(r2 ? [{ id: r2.id, label: 'flux-kontext-pro + image string (NEW)' }] : [])
  ];
  
  for (const t of allTasks) {
    const res = await checkResult(t.id);
    console.log(`\n=== ${t.label} ===`);
    console.log(`Status: ${res.status}, URL: ${res.url || 'none'}`);
  }
})();

function checkResult(taskId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ task_id: taskId });
    const req = https.request({
      hostname: 'gptunnel.ru',
      path: '/v1/media/result',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}
