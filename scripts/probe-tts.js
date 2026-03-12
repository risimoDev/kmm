// Проверяем GPTunnel TTS API
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
        catch { resolve({ status: res.statusCode, body: d.substring(0, 500) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // 1. GPTunnel TTS — создать задание
  console.log('=== GPTunnel TTS create ===');
  const ttsBody = {
    model: 'tts-1',
    input: 'Привет! Это тестовый голос для видео.',
    voice: 'alloy',
    language: 'ru'
  };
  const r1 = await req('gptunnel.ru', '/v1/tts/create', 'POST', ttsBody, {
    Authorization: GPTUNNEL_KEY
  });
  console.log('status:', r1.status, JSON.stringify(r1.body).substring(0, 500));

  // 2. GPTunnel TTS — похожий эндпоинт
  console.log('\n=== GPTunnel TTS audio (OpenAI compat) ===');
  const r2 = await req('gptunnel.ru', '/v1/audio/speech', 'POST', ttsBody, {
    Authorization: `Bearer ${GPTUNNEL_KEY}`
  });
  console.log('status:', r2.status, JSON.stringify(r2.body || '(binary)').substring(0, 300));
})();
