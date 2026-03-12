// Test: Upload audio to MinIO and verify it's accessible via public URL
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const MINIO_HOST = '127.0.0.1';
const MINIO_PORT = 9000;
const MINIO_ACCESS = 'minioadmin';
const MINIO_SECRET = 'adminrisimofloor';
const BUCKET = 'audio-public';
const PUBLIC_HOST = '193.233.134.235'; // VPS public IP

// Simple AWS-style S3 request helper
function s3Request(method, path, body, contentType) {
  return new Promise((resolve) => {
    const date = new Date().toUTCString();
    const opts = {
      hostname: MINIO_HOST,
      port: MINIO_PORT,
      path,
      method,
      headers: {
        'Host': `${MINIO_HOST}:${MINIO_PORT}`,
        'Date': date,
        ...(body ? { 'Content-Length': Buffer.byteLength(body), 'Content-Type': contentType || 'application/octet-stream' } : {}),
        ...(body ? {} : { 'Content-Length': '0' }),
      }
    };
    // Use basic auth (MinIO supports it for initial setup)
    const auth = Buffer.from(`${MINIO_ACCESS}:${MINIO_SECRET}`).toString('base64');
    opts.headers['Authorization'] = `Basic ${auth}`;

    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d.substring(0, 500) }));
    });
    req.on('error', e => resolve({ error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let size = 0;
      res.on('data', c => size += c.length);
      res.on('end', () => resolve({ status: res.statusCode, size }));
    }).on('error', e => resolve({ error: e.message }));
  });
}

(async () => {
  console.log('=== Test 1: MinIO health ===');
  const health = await httpGet(`http://${MINIO_HOST}:${MINIO_PORT}/minio/health/live`);
  console.log('MinIO health:', health);

  console.log('\n=== Test 2: List buckets ===');
  const list = await s3Request('GET', '/');
  console.log('Status:', list.status, list.body.substring(0, 200));

  console.log('\n=== Test 3: Create bucket ===');
  const create = await s3Request('PUT', `/${BUCKET}`);
  console.log('Create bucket status:', create.status, create.body);

  console.log('\n=== Test 4: Set bucket public policy ===');
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${BUCKET}/*`]
    }]
  });
  const setPol = await s3Request('PUT', `/${BUCKET}?policy`, policy, 'application/json');
  console.log('Set policy status:', setPol.status, setPol.body);

  console.log('\n=== Test 5: Upload a small test MP3 ===');
  const testData = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00' + '\xff\xfb\x90\x00').toString('binary');
  const upload = await s3Request('PUT', `/${BUCKET}/test-audio.mp3`, testData, 'audio/mpeg');
  console.log('Upload status:', upload.status);

  console.log('\n=== Test 6: Check public access via VPS IP ===');
  const check = await httpGet(`http://${PUBLIC_HOST}:9000/${BUCKET}/test-audio.mp3`);
  console.log('Public access:', check);

  console.log('\n=== Summary ===');
  if (check.status === 200) {
    console.log('✅ MinIO public access WORKS!');
    console.log(`   Audio URL format: http://${PUBLIC_HOST}:9000/${BUCKET}/voice_SESSION_a2e.mp3`);
  } else {
    console.log('❌ MinIO public access failed');
    console.log('   Need alternative approach');
  }
})();
