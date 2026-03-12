// Probe A2E for alternative audio upload approaches
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = 'sk_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTk4OGQ1MWZjMjRhMjAwNThmNDk4MTIiLCJuYW1lIjoibGV2cnVyaXNpbW9AZ21haWwuY29tIiwicm9sZSI6ImNvaW4iLCJpYXQiOjE3NzE3OTQ3OTJ9.82KJqOcyFbslvJrMkGUmfqe8yskcgQ8I-NXJou2by58';
const ANCHOR = '693bf9bd3caab0848a4cd107';

function req(method, urlPath, body, contentType) {
  return new Promise((resolve) => {
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))) : null;
    const opts = {
      hostname: 'video.a2e.ai',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(data ? { 'Content-Length': data.length, 'Content-Type': contentType || 'application/json' } : {}),
      }
    };
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        try { resolve({ status: res.statusCode, body: JSON.parse(body.toString()), raw: body.toString().substring(0, 500) }); }
        catch { resolve({ status: res.statusCode, raw: body.toString().substring(0, 500) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

function multipartReq(urlPath, filename, audioBuffer) {
  return new Promise((resolve) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, audioBuffer, footer]);
    
    const opts = {
      hostname: 'video.a2e.ai',
      path: urlPath,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      }
    };
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rbody = Buffer.concat(chunks);
        resolve({ status: res.statusCode, raw: rbody.toString().substring(0, 500) });
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    r.write(body);
    r.end();
  });
}

(async () => {
  // Read the actual MP3 file
  const mp3File = path.join(__dirname, '..', 'output', 'voice_27_a2e.mp3');
  let mp3Buffer = null;
  try {
    mp3Buffer = fs.readFileSync(mp3File);
    console.log(`MP3 loaded: ${mp3Buffer.length} bytes`);
  } catch(e) {
    console.log('Could not read MP3 file, using dummy data');
    mp3Buffer = Buffer.alloc(100, 0xFF);
  }

  const mp3Base64 = mp3Buffer.toString('base64');

  // Test 1: audioSrc as data URI
  console.log('\n=== Test 1: audioSrc as data URI ===');
  const r1 = await req('POST', '/api/v1/video/generate', {
    anchor_id: ANCHOR,
    anchor_type: 0,
    audioSrc: `data:audio/mpeg;base64,${mp3Base64.substring(0, 100)}`,
    script: 'test'
  });
  console.log('Status:', r1.status, r1.raw.substring(0, 200));

  // Test 2: Probe audio upload endpoint
  console.log('\n=== Test 2: POST audio upload ===');
  const r2 = await multipartReq('/api/v1/audio/upload', 'test.mp3', mp3Buffer.slice(0, 1000));
  console.log('Status:', r2.status, r2.raw.substring(0, 200));

  // Test 3: Probe video audio upload
  console.log('\n=== Test 3: POST video/audio ===');
  const r3 = await multipartReq('/api/v1/video/audio', 'test.mp3', mp3Buffer.slice(0, 1000));
  console.log('Status:', r3.status, r3.raw.substring(0, 200));

  // Test 4: Probe anchor audio upload
  console.log('\n=== Test 4: POST anchor/audio ===');
  const r4 = await multipartReq('/api/v1/anchor/audio', 'test.mp3', mp3Buffer.slice(0, 1000));
  console.log('Status:', r4.status, r4.raw.substring(0, 200));

  // Test 5: Try the known-good public URL approach to confirm
  console.log('\n=== Test 5: Known-good public URL ===');
  const r5 = await req('POST', '/api/v1/video/generate', {
    anchor_id: ANCHOR,
    anchor_type: 0,
    audioSrc: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    script: 'Hello world'
  });
  console.log('Status:', r5.status, JSON.stringify(r5.body || r5.raw).substring(0, 200));

  // Test 6: audioSrc with k-m-m.ru URL (currently failing)
  console.log('\n=== Test 6: k-m-m.ru URL ===');
  const r6 = await req('POST', '/api/v1/video/generate', {
    anchor_id: ANCHOR,
    anchor_type: 0,
    audioSrc: 'https://k-m-m.ru/output/voice_27_a2e.mp3',
    script: 'Hello world'
  });
  console.log('Status:', r6.status, JSON.stringify(r6.body || r6.raw).substring(0, 300));

})();
