// Check the actual workflow in n8n
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const wf = JSON.parse(data);
  const nodes = Array.isArray(wf) ? wf[0].nodes : wf.nodes;
  
  // Find the AI analysis HTTP node
  const aiNode = nodes.find(n => n.name && n.name.includes('AI'));
  if (aiNode) {
    console.log('=== AI Node ===');
    console.log(JSON.stringify(aiNode.parameters, null, 2));
    console.log('Credentials:', JSON.stringify(aiNode.credentials));
  }
  
  // Find the build body code node  
  const buildNode = nodes.find(n => n.name && n.name.includes('Запрос'));
  if (buildNode) {
    console.log('\n=== Build Body Node ===');
    console.log('jsCode length:', buildNode.parameters.jsCode.length);
    // Check for $env usage
    if (buildNode.parameters.jsCode.includes('$env')) {
      console.log('WARNING: still uses $env!');
    }
  }

  // Find config node
  const cfgNode = nodes.find(n => n.name && n.name.includes('Конфиг'));
  if (cfgNode) {
    console.log('\n=== Config Node ===');
    console.log(cfgNode.parameters.jsCode);
  }

  console.log('\nTotal nodes:', nodes.length);
});
