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
        catch { resolve({ status: res.statusCode, body: d.substring(0, 500) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const ANCHOR = '693bf9bd3caab0848a4cd107';

  // 1. Проверяем список пользовательских голосов (не системных)
  console.log('=== User voices ===');
  const uv = await req('GET', '/api/v1/anchor/voice_list?type=custom');
  console.log(JSON.stringify(uv.body).substring(0, 300));

  // 2. Голоса аккаунта
  console.log('\n=== My voices ===');
  const mv = await req('GET', '/api/v1/anchor/voice_list?type=my');
  console.log(JSON.stringify(mv.body).substring(0, 300));

  // 3. Попробуем audioSrc с тестовым MP3
  console.log('\n=== audioSrc test ===');
  const testMp3 = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
  const r3 = await req('POST', '/api/v1/video/generate', {
    anchor_id: ANCHOR,
    anchor_type: 0,
    script: 'Hello world',
    audioSrc: testMp3
  });
  console.log('status:', r3.status, JSON.stringify(r3.body).substring(0, 300));

  // 4. tts_text вместо script+voice (некоторые API так работают)
  console.log('\n=== tts_text test ===');
  const r4 = await req('POST', '/api/v1/video/generate', {
    anchor_id: ANCHOR,
    anchor_type: 0,
    tts_text: 'Hello world'
  });
  console.log('status:', r4.status, JSON.stringify(r4.body).substring(0, 300));

  // 5. Без custom_voice, но с voice_id (разные имена поля)
  console.log('\n=== voice_id field test ===');
  const r5 = await req('POST', '/api/v1/video/generate', {
    anchor_id: ANCHOR,
    anchor_type: 0,
    script: 'Hello world',
    voice_id: '6627e0b42f07d4f2a89a19fe'
  });
  console.log('status:', r5.status, JSON.stringify(r5.body).substring(0, 300));
})();
