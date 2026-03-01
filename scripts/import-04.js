// Import workflow 04 into n8n via API
const http = require('http');
const fs = require('fs');

const wf = JSON.parse(fs.readFileSync('/app/wf04.json', 'utf8'));
const apiKey = 'cf-n8n-api-key-s3cr3t-2024';

// First get existing workflow to find its ID
const listOpts = {
  hostname: 'n8n',
  port: 5678,
  path: '/api/v1/workflows',
  method: 'GET',
  headers: { 'X-N8N-API-KEY': apiKey }
};

const listReq = http.request(listOpts, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const workflows = JSON.parse(data);
    const target = (workflows.data || []).find(w => w.name.includes('04'));
    if (!target) {
      console.log('Workflow 04 not found. Importing as new...');
      importNew();
    } else {
      console.log('Found workflow:', target.id, target.name);
      updateExisting(target.id);
    }
  });
});
listReq.on('error', e => console.error('List error:', e));
listReq.end();

function updateExisting(id) {
  const body = JSON.stringify(wf);
  const opts = {
    hostname: 'n8n',
    port: 5678,
    path: '/api/v1/workflows/' + id,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey
    }
  };
  const req = http.request(opts, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('UPDATE status:', res.statusCode);
      if (res.statusCode === 200) {
        const r = JSON.parse(data);
        console.log('Updated:', r.id, r.name, '| nodes:', r.nodes?.length);
      } else {
        console.log('Response:', data.substring(0, 500));
      }
    });
  });
  req.on('error', e => console.error('Update error:', e));
  req.write(body);
  req.end();
}

function importNew() {
  const body = JSON.stringify(wf);
  const opts = {
    hostname: 'n8n',
    port: 5678,
    path: '/api/v1/workflows',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey
    }
  };
  const req = http.request(opts, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('IMPORT status:', res.statusCode);
      if (res.statusCode === 200) {
        const r = JSON.parse(data);
        console.log('Imported:', r.id, r.name, '| nodes:', r.nodes?.length);
      } else {
        console.log('Response:', data.substring(0, 500));
      }
    });
  });
  req.on('error', e => console.error('Import error:', e));
  req.write(body);
  req.end();
}
