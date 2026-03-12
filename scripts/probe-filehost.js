// Quick test: try multiple file hosting options from Node.js
const https = require('https');
const fs = require('fs');

const TOKEN = 'sk_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTk4OGQ1MWZjMjRhMjAwNThmNDk4MTIiLCJuYW1lIjoibGV2cnVyaXNpbW9AZ21haWwuY29tIiwicm9sZSI6ImNvaW4iLCJpYXQiOjE3NzE3OTQ3OTJ9.82KJqOcyFbslvJrMkGUmfqe8yskcgQ8I-NXJou2by58';
const ANCHOR = '693bf9bd3caab0848a4cd107';

function a2eTest(audioSrc) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ anchor_id: ANCHOR, anchor_type: 0, audioSrc, script: 'test' });
    const r = https.request({
      hostname: 'video.a2e.ai', path: '/api/v1/video/generate', method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({ raw: Buffer.concat(chunks).toString().substring(0, 200) }); } });
    });
    r.on('error', e => resolve({ error: e.message }));
    r.write(data); r.end();
  });
}

function multipartUpload(hostname, path, mp3Buffer, filename) {
  return new Promise((resolve) => {
    const boundary = `boundary${Date.now()}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), mp3Buffer, Buffer.from(footer)]);
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    };
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { 
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()), raw: Buffer.concat(chunks).toString().substring(0,300) }); }
        catch { resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString().substring(0,300) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    setTimeout(() => resolve({ error: 'timeout' }), 10000);
    r.write(body); r.end();
  });
}

(async () => {
  const mp3 = fs.readFileSync('e:\\contend-factory\\output\\voice_27_a2e.mp3');
  console.log(`MP3 size: ${mp3.length}`);

  // Test 1: tmpfiles.org
  console.log('\n=== tmpfiles.org ===');
  const t1 = await multipartUpload('tmpfiles.org', '/api/v1/upload', mp3, 'voice.mp3');
  console.log(JSON.stringify(t1).substring(0, 300));

  // Test 2: file.io (single-use but try it)
  console.log('\n=== file.io ===');
  const t2 = await multipartUpload('file.io', '/', mp3, 'voice.mp3');
  console.log(JSON.stringify(t2).substring(0, 300));

  // Test 3: bashupload.com
  console.log('\n=== bashupload.com PUT ===');
  const t3 = await new Promise((resolve) => {
    const r = https.request({
      hostname: 'bashupload.com', path: '/voice.mp3', method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString().substring(0,300) }));
    });
    r.on('error', e => resolve({ error: e.message }));
    setTimeout(() => resolve({ error: 'timeout' }), 10000);
    r.write(mp3); r.end();
  });
  console.log(JSON.stringify(t3).substring(0, 300));
  
  // Test any that returned a URL with A2E
  const services = [
    { name: 'tmpfiles', result: t1 },
    { name: 'fileio', result: t2 },
    { name: 'bashupload', result: t3 }
  ];
  
  for (const { name, result } of services) {
    const raw = typeof result.raw === 'string' ? result.raw : JSON.stringify(result);
    const urlMatch = raw.match(/https?:\/\/[^\s"]+\.(mp3|wav|m4a|audio)[^\s"]*/i) ||
                     raw.match(/"url"\s*:\s*"(https?:\/\/[^\s"]+)"/);
    if (urlMatch) {
      const url = urlMatch[1] || urlMatch[0];
      console.log(`\n=== Testing ${name} URL with A2E: ${url} ===`);
      const a2eResult = await a2eTest(url);
      console.log(`A2E code: ${a2eResult.code}, msg: ${a2eResult.msg}`);
    }
  }
})();
