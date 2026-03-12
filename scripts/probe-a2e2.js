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
  // 1. Посмотрим список аватаров
  console.log('=== Список аватаров (default) ===');
  const avatars = await req('GET', '/api/v1/anchor/character_list?type=default');
  console.log('Status:', avatars.status);
  const list = avatars.body?.data || [];
  if (list.length) {
    console.log(`Найдено аватаров: ${list.length}`);
    list.slice(0, 3).forEach(a => console.log(`  _id: ${a._id}, name: ${a.name || a.anchor_name || '—'}`));
  } else {
    console.log('Ответ:', JSON.stringify(avatars.body).substring(0, 400));
  }

  // 2. Сначала пробуем только с anchor_id
  const ANCHOR_ID = list[0]?._id || '6998a12bfc24a20058f49900'; // плацехолдер
  if (!list.length) {
    console.log('\nНет аватаров — пробуем с placeholder anchor_id:', ANCHOR_ID);
  }

  const tests = [
    // С anchor_id + script
    { anchor_id: ANCHOR_ID, script: 'Привет, это тест' },
    // С anchor_id + voice_id  
    { anchor_id: ANCHOR_ID, script: 'test', bg_image: 'https://k-m-m.ru/api/media/public/images/1772881240516-b87125ce75aa7a87.jpg' },
  ];

  for (const t of tests) {
    const r = await req('POST', '/api/v1/video/generate', t);
    console.log(`\nPOST /generate body:`, JSON.stringify(t));
    console.log(`→ ${r.status} | ${JSON.stringify(r.body).substring(0, 300)}`);
  }

  // 3. Получить голоса
  console.log('\n=== Голоса ===');
  const voices = await req('GET', '/api/v1/anchor/voice_list');
  console.log('Status:', voices.status);
  const vlist = voices.body?.data || [];
  console.log(`Голосов: ${vlist.length}`);
  if (vlist.length) vlist.slice(0, 3).forEach(v => console.log(`  _id: ${v._id}, name: ${v.name || v.voice_name || '—'}`));
})();
