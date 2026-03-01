// Test trigger for product-card webhook
const http = require('http');

const body = JSON.stringify({
  product_name: 'Test Mug',
  image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
  marketplace: 'WB'
});

const req = http.request({
  hostname: 'localhost',
  port: 5678,
  path: '/webhook/product-card',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (e) => console.log('Error:', e.message));
req.write(body);
req.end();
