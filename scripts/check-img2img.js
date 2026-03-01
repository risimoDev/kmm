// Проверка результатов тестовых генераций
const https = require('https');
const API_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';

const tasks = [
  { id: '69a4c6590a686300013b7910', label: 'flux-kontext-pro + images[]' },
  { id: '69a4c65b4aad5500019b29c8', label: 'gpt-image-1-low + images[]' },
  { id: '69a4c65b89ac0e0001e47c5f', label: 'flux-kontext-pro (text only)' },
  { id: '69a4c65c89ac0e0001e47c60', label: 'gpt-image-1-low + image (string)' }
];

function checkResult(taskId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ task_id: taskId });
    const req = https.request({
      hostname: 'gptunnel.ru',
      path: '/v1/media/result',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const t of tasks) {
    const r = await checkResult(t.id);
    console.log(`\n=== ${t.label} ===`);
    console.log(`Status: ${r.status}, URL: ${r.url || 'none'}`);
    if (r.status === 'fail' || r.status === 'failed') {
      console.log(`Error: ${JSON.stringify(r).substring(0, 400)}`);
    }
  }
})();
