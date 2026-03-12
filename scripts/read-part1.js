const fs = require('fs');
const dir = 'Part 1. n8n workflow';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
for (const f of files) {
  try {
    const wf = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'));
    const nodes = wf.nodes || [];
    const urls = nodes.filter(n => n.parameters && n.parameters.url).map(n => '  ' + n.name + '\n    url: ' + n.parameters.url);
    if (urls.length) {
      console.log('\n=== ' + f + ' ===');
      urls.forEach(u => console.log(u));
    }
    // Also show code nodes with a2e or audioSrc or voice
    const codeNodes = nodes.filter(n => n.type === 'n8n-nodes-base.code' && n.parameters && n.parameters.jsCode && 
      (n.parameters.jsCode.includes('a2e') || n.parameters.jsCode.includes('audioSrc') || n.parameters.jsCode.includes('anchor_id')));
    if (codeNodes.length) {
      console.log('  CODE nodes with a2e:');
      codeNodes.forEach(n => console.log('   ', n.name));
    }
  } catch(e) { console.log('ERR', f, e.message); }
}
