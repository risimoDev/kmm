// Deploy n8n workflows via API (PUT = full replace, no "1" suffix problem)
// Usage:
//   node scripts/deploy-workflows.js                          -- deploy all
//   node scripts/deploy-workflows.js 02-video-factory-a2e-product.json  -- deploy one file
//   N8N_URL=http://localhost:5678 node scripts/deploy-workflows.js

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url  = require('url');

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const API_KEY  = process.env.N8N_API_KEY || 'cf-n8n-api-key-s3cr3t-2024';
const WF_DIR   = path.join(__dirname, '..', 'workflows');

// ── helpers ───────────────────────────────────────────────────────────────────

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(N8N_URL);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const data   = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     urlPath,
      method,
      headers: {
        'X-N8N-API-KEY':  API_KEY,
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = lib.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listWorkflows() {
  const res = await request('GET', '/api/v1/workflows?limit=100');
  if (res.status !== 200) throw new Error('Cannot list workflows: ' + JSON.stringify(res.body));
  return res.body.data || [];
}

// n8n PUT /api/v1/workflows/{id} only allows these fields
const ALLOWED_PUT_FIELDS = ['name', 'nodes', 'connections', 'settings', 'staticData', 'versionId'];

async function deployFile(filePath, existingWorkflows) {
  const raw  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const name = raw.name;
  if (!name) { console.warn(`⚠️  ${path.basename(filePath)} has no "name" field, skipping`); return; }

  // Strip fields not allowed by the n8n PUT API (tags, triggerCount, updatedAt, etc.)
  const wf = {};
  for (const k of ALLOWED_PUT_FIELDS) {
    if (raw[k] !== undefined) wf[k] = raw[k];
  }
  wf.name = name;

  const existing = existingWorkflows.find(w => w.name === name);

  if (existing) {
    console.log(`↻  Updating  "${name}" (id=${existing.id})...`);
    // PUT replaces all nodes+connections cleanly — NO "1" suffix renaming
    const res = await request('PUT', `/api/v1/workflows/${existing.id}`, wf);
    if (res.status === 200) {
      console.log(`✅  Updated  "${name}" — ${res.body.nodes?.length ?? '?'} nodes`);
    } else {
      console.error(`❌  Update FAILED for "${name}": ${res.status}`, JSON.stringify(res.body).substring(0, 400));
    }
  } else {
    console.log(`+   Creating "${name}"...`);
    const res = await request('POST', '/api/v1/workflows', wf);
    if (res.status === 200 || res.status === 201) {
      console.log(`✅  Created  "${name}" (id=${res.body.id})`);
    } else {
      console.error(`❌  Create FAILED for "${name}": ${res.status}`, JSON.stringify(res.body).substring(0, 400));
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Collect files to deploy
  let files;
  if (args.length === 0 || args[0] === '--all') {
    files = fs.readdirSync(WF_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(WF_DIR, f));
    console.log(`\nDeploying ALL ${files.length} workflows to ${N8N_URL}\n`);
  } else {
    files = args.map(a => {
      const abs = path.isAbsolute(a) ? a : path.join(WF_DIR, a);
      if (!fs.existsSync(abs)) { console.error('File not found:', abs); process.exit(1); }
      return abs;
    });
    console.log(`\nDeploying ${files.length} workflow(s) to ${N8N_URL}\n`);
  }

  // Fetch current workflows once
  let existing;
  try {
    existing = await listWorkflows();
    console.log(`Found ${existing.length} existing workflows in n8n\n`);
  } catch (e) {
    console.error('❌  Cannot reach n8n API:', e.message);
    console.error('   Make sure n8n is running and N8N_API_KEY is correct.');
    console.error(`   N8N_URL = ${N8N_URL}`);
    process.exit(1);
  }

  for (const f of files) {
    await deployFile(f, existing);
  }
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
