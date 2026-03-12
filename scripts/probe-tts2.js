const https = require('https');
const GPTUNNEL_KEY = 'shds-ge6yXZzsC2OLNOxz1AbUEggeXnS';

function req(hostname, path, method, body, headers) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d.substring(0, 800) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // Правильный формат GPTunnel TTS
  const r1 = await req('gptunnel.ru', '/v1/tts/create', 'POST', {
    text: 'Привет! Это тест.',
    voice_id: '65f4092eddc5862248a18111'
  }, { Authorization: GPTUNNEL_KEY });
  console.log('TTS create status:', r1.status);
  console.log(JSON.stringify(r1.body, null, 2).substring(0, 1000));

  // Если есть file_id в ответе — проверим result
  const fid = r1.body?.data?.file_id || r1.body?.file_id || r1.body?.data;
  if (fid) {
    console.log('\n=== TTS result ===');
    const r2 = await req('gptunnel.ru', '/v1/tts/result', 'POST', { file_id: fid }, { Authorization: GPTUNNEL_KEY });
    console.log('status:', r2.status, JSON.stringify(r2.body, null, 2).substring(0, 600));
  }
})();
