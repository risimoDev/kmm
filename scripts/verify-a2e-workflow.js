// Print the execution chain of the A2E workflow from merge-data node
const wf   = require('../workflows/02-video-factory-a2e-product.json');
const conn = wf.connections;

function printChain(nodeName, depth, visited) {
  if (depth > 12) return;
  if (visited.has(nodeName)) { console.log('  '.repeat(depth) + '↻  ' + nodeName + ' (loop)'); return; }
  visited.add(nodeName);
  const indent = '  '.repeat(depth);
  console.log(indent + '→ ' + nodeName);
  const out = conn[nodeName] || {};
  (out.main || []).forEach((targets) => {
    (targets || []).forEach(t => printChain(t.node, depth + 1, new Set(visited)));
  });
}

console.log('=== Execution chain from merge-data ===\n');
printChain('🔗 Объединение данных', 0, new Set());

// Also check that tts-save-audio node code is correct
const ttsSave = wf.nodes.find(n => n.id === 'tts-save-audio');
if (ttsSave) {
  const code = ttsSave.parameters.jsCode;
  const hasMergeRef = code.includes('Объединение данных');
  const hasOldRef = code.includes('Восстановить после шага');
  console.log('\n=== tts-save-audio code check ===');
  console.log('  Has merge-data reference:', hasMergeRef ? '✅ YES' : '❌ NO');
  console.log('  Has old fragile reference:', hasOldRef ? '❌ YES (BAD)' : '✅ NO');
}

// Check a2e node sends audioSrc
const a2eNode = wf.nodes.find(n => n.id === 'a2e-start-video');
if (a2eNode) {
  const body = a2eNode.parameters.jsonBody || '';
  console.log('\n=== A2E request body ===');
  console.log('  Has audioSrc:', body.includes('audioSrc') ? '✅ YES' : '❌ NO');
  console.log('  Has custom_voice:', body.includes('custom_voice') ? '❌ YES (BAD)' : '✅ NO');
}

// Check TTS node points to gptunnel
const ttsGen = wf.nodes.find(n => n.id === 'tts-generate');
if (ttsGen) {
  const url = ttsGen.parameters.url || '';
  console.log('\n=== TTS generate node ===');
  console.log('  URL:', url);
}
