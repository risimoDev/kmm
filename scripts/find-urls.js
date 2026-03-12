const fs = require('fs');

// Ищем все HTTP URL во всех воркфлоу
const files = fs.readdirSync('workflows').filter(f => f.endsWith('.json'));
for (const f of files) {
  const wf = JSON.parse(fs.readFileSync('workflows/' + f, 'utf8'));
  for (const n of wf.nodes) {
    const url = n.parameters && n.parameters.url;
    if (url && (url.includes('a2e') || url.includes('video'))) {
      console.log(f, '|', n.name, '| url:', url);
    }
  }
}

// Также смотрим app_settings в БД
console.log('\nClues from scripts:');
if (fs.existsSync('scripts/patch-a2e-workflow.js')) {
  const txt = fs.readFileSync('scripts/patch-a2e-workflow.js', 'utf8');
  const urls = txt.match(/https?:\/\/[a-zA-Z0-9._/-]+/g) || [];
  console.log('patch-a2e-workflow.js urls:', [...new Set(urls)]);
  const baseUrl = txt.match(/a2e_base_url[^'"\n]+/g) || [];
  console.log('a2e_base_url refs:', baseUrl.slice(0,5));
}
