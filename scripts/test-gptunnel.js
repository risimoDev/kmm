const https = require('https');

// Simple text request
const textBody = JSON.stringify({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello in 3 words' }],
  max_tokens: 10
});

// Vision request (same as workflow 04)
const visionBody = JSON.stringify({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are a product designer.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image briefly' },
        { type: 'image_url', image_url: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png', detail: 'high' } }
      ]
    }
  ],
  max_tokens: 100,
  temperature: 0.7
});

function makeRequest(label, body) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'gptunnel.ru',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`\n=== ${label} ===`);
        console.log(`Status: ${res.statusCode}`);
        console.log(`Body: ${data.substring(0, 500)}`);
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`\n=== ${label} ERROR ===`);
      console.log(e.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  await makeRequest('TEXT (should work)', textBody);
  await makeRequest('VISION (may fail)', visionBody);
})();
