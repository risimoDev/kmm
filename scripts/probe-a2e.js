const https = require('https');

const TOKEN = 'sk_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTk4OGQ1MWZjMjRhMjAwNThmNDk4MTIiLCJuYW1lIjoibGV2cnVyaXNpbW9AZ21haWwuY29tIiwicm9sZSI6ImNvaW4iLCJpYXQiOjE3NzE3OTQ3OTJ9.82KJqOcyFbslvJrMkGUmfqe8yskcgQ8I-NXJou2by58';

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'video.a2e.ai',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d.substring(0, 300) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const paths = [
    { m: 'GET',  p: '/api/v1/user/remainingCoins' },
    { m: 'POST', p: '/api/v1/video/create', b: { prompt: 'test', resolution: '720' } },
    { m: 'POST', p: '/api/v1/anchor/video', b: { prompt: 'test' } },
    { m: 'POST', p: '/api/v1/anchor/create_video', b: { prompt: 'test' } },
    { m: 'POST', p: '/api/v1/video/submit', b: { prompt: 'test' } },
    { m: 'POST', p: '/api/v1/video/generate', b: { prompt: 'test' } },
    { m: 'POST', p: '/api/v1/video/img2video', b: { image_url: 'test', prompt: 'test' } },
  ];

  for (const { m, p, b } of paths) {
    const r = await req(m, p, b);
    console.log(`${m} ${p} → ${r.status || 'ERR'} | ${JSON.stringify(r.body || r.error).substring(0, 120)}`);
  }
})();
