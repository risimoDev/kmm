// Test GoFile.io upload and get direct download URL
// then test with A2E
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = 'sk_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTk4OGQ1MWZjMjRhMjAwNThmNDk4MTIiLCJuYW1lIjoibGV2cnVyaXNpbW9AZ21haWwuY29tIiwicm9sZSI6ImNvaW4iLCJpYXQiOjE3NzE3OTQ3OTJ9.82KJqOcyFbslvJrMkGUmfqe8yskcgQ8I-NXJou2by58';
const ANCHOR = '693bf9bd3caab0848a4cd107';

function httpsGet(url) {
  return new Promise((resolve) => {
    const r = https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body, headers: res.headers }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
  });
}

function httpsPost(hostname, path, data, headers) {
  return new Promise((resolve) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const opts = { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } };
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(body), raw: body.substring(0, 500) }); }
        catch { resolve({ status: res.statusCode, raw: body.substring(0, 500) }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    r.write(buf);
    r.end();
  });
}

function uploadToGoFile(mp3Buffer) {
  return new Promise((resolve) => {
    const boundary = `boundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, mp3Buffer, footer]);
    
    const opts = {
      hostname: 'upload.gofile.io',
      path: '/uploadFile',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      }
    };
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rbody = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(rbody)); } catch { resolve({ error: rbody }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    r.write(body);
    r.end();
  });
}

function a2eGenerate(audioSrc) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ anchor_id: ANCHOR, anchor_type: 0, audioSrc, script: 'test' });
    const opts = {
      hostname: 'video.a2e.ai',
      path: '/api/v1/video/generate',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); }
      });
    });
    r.on('error', e => resolve({ error: e.message }));
    r.write(data);
    r.end();
  });
}

(async () => {
  const mp3Path = path.join(__dirname, '..', 'output', 'voice_27_a2e.mp3');
  const mp3Buffer = fs.readFileSync(mp3Path);
  console.log(`MP3: ${mp3Buffer.length} bytes`);

  // 1. Upload to GoFile
  console.log('\n=== Uploading to GoFile ===');
  const upload = await uploadToGoFile(mp3Buffer);
  console.log(JSON.stringify(upload).substring(0, 500));

  if (upload.status === 'ok' && upload.data) {
    const server = upload.data.servers?.[0];
    const fileId = upload.data.id;
    const folderCode = upload.data.parentFolderCode;
    const fileName = upload.data.name;
    
    // GoFile direct download URL format
    const directUrl = `https://${server}.gofile.io/downloadPage/${folderCode}/${fileName}`;
    const directUrl2 = `https://${server}.gofile.io/download/${fileId}/${fileName}`;
    
    console.log(`\nFolder code: ${folderCode}`);
    console.log(`Server: ${server}`);
    console.log(`Direct URL attempt 1: ${directUrl}`);
    console.log(`Direct URL attempt 2: ${directUrl2}`);
    
    // 2. Test with A2E
    console.log('\n=== Test with A2E (direct URL) ===');
    const a2eResult = await a2eGenerate(directUrl2);
    console.log('A2E result:', JSON.stringify(a2eResult).substring(0, 300));
    
    if (a2eResult.code !== 0) {
      // Try URL 2
      console.log('\n=== Test with A2E (URL format 2) ===');
      const a2eResult2 = await a2eGenerate(directUrl);
      console.log('A2E result2:', JSON.stringify(a2eResult2).substring(0, 300));
    }
    
    // 3. Get content via API
    console.log('\n=== GoFile content API ===');
    const content = await httpsGet(`https://api.gofile.io/getContent?contentId=${folderCode}&token=${upload.data.guestToken}`);
    console.log('Content:', JSON.stringify(content).substring(0, 600));
  }
})();
