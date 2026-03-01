// Тест: поддерживает ли GPTunnel Seedream референс-фото
const https = require('https');

const API_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';

// Тест 1: обычный text-to-image (контроль)
const testText = JSON.stringify({
  model: 'seedream-3',
  ar: '9:16',
  prompt: 'A red apple on white background, product photo'
});

// Тест 2: с референс-фото (проверяем поддержку)
const testWithImage = JSON.stringify({
  model: 'seedream-3',
  ar: '9:16',
  prompt: 'Professional product infographic with this product in center',
  image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/800px-Red_Apple.jpg'
});

// Тест 3: альтернативный параметр reference_image
const testRefImage = JSON.stringify({
  model: 'seedream-3',
  ar: '9:16',
  prompt: 'Professional product infographic with this product in center',
  reference_image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/800px-Red_Apple.jpg'
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
        console.log(`Response: ${data.substring(0, 500)}`);
        resolve(data);
      });
    });
    req.on('error', e => { console.log(`${label} ERROR: ${e.message}`); resolve(''); });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('Тестирование Seedream API параметров...\n');
  await makeReq('TEXT ONLY (контроль)', testText);
  await makeReq('С image= URL', testWithImage);
  await makeReq('С reference_image= URL', testRefImage);
})();
