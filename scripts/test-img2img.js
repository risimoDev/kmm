// Тест: flux-kontext-pro и gpt-image-1 с референс-фото (images массив)
const https = require('https');
const API_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';
const TEST_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/800px-Red_Apple.jpg';

// Тест 1: flux-kontext-pro с images
const test1 = JSON.stringify({
  model: 'flux-kontext-pro',
  prompt: 'Place this product on a clean white studio background with soft lighting. Add infographic elements: feature callouts, icons around the product. Professional marketplace product card, vertical 9:16',
  images: [TEST_IMAGE]
});

// Тест 2: gpt-image-1-low с images (дешевый для теста)
const test2 = JSON.stringify({
  model: 'gpt-image-1-low',
  prompt: 'Take this product and create a professional marketplace infographic card. Keep the product EXACTLY as shown. Add marketing elements: feature icons, text callouts, gradient background. Clean modern style. Vertical 9:16',
  images: [TEST_IMAGE]
});

// Тест 3: flux-kontext-pro без images (контроль)
const test3 = JSON.stringify({
  model: 'flux-kontext-pro',
  prompt: 'Professional red apple product infographic on white background, marketing elements, feature callouts, vertical 9:16'
});

// Тест 4: gpt-image-1-low с image (единственное поле, не массив)
const test4 = JSON.stringify({
  model: 'gpt-image-1-low',
  prompt: 'Edit this product photo to add professional infographic elements: feature callouts, icons, gradient background. Keep the product unchanged.',
  image: TEST_IMAGE
});

function makeReq(label, body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'gptunnel.ru',
      path: '/v1/media/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`\n=== ${label} ===`);
        console.log(`Status: ${res.statusCode}`);
        try {
          const j = JSON.parse(data);
          console.log(`Code: ${j.code}, ID: ${j.id || 'none'}, Model: ${j.model || 'none'}, Status: ${j.status || 'none'}`);
          if (j.code !== 0) console.log(`Error: ${data.substring(0, 300)}`);
        } catch(e) {
          console.log(`Raw: ${data.substring(0, 400)}`);
        }
        resolve(data);
      });
    });
    req.on('error', e => { console.log(`${label} ERROR: ${e.message}`); resolve(''); });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('=== Тестирование img2img моделей GPTunnel ===\n');
  await makeReq('flux-kontext-pro + images[]', test1);
  await makeReq('gpt-image-1-low + images[]', test2);
  await makeReq('flux-kontext-pro (text only)', test3);
  await makeReq('gpt-image-1-low + image (string)', test4);
  
  console.log('\n\nЖдём 30с и проверяем результаты...');
  await new Promise(r => setTimeout(r, 30000));
  
  // на всякий проверим результаты
  // Собираем task_ids
})();
