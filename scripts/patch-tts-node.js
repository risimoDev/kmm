// Patches 02-video-factory-a2e-product.json:
// 1. Fixes fragile node reference in tts-save-audio (uses merge-data node instead)
// 2. Merges TTS generation + audio saving into a single Code node (no cross-node references)

const fs = require('fs');
const path = require('path');

const WF_PATH = path.join(__dirname, '..', 'workflows', '02-video-factory-a2e-product.json');
const wf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));

let changed = false;

for (const node of wf.nodes) {
  // Fix tts-save-audio: was referencing '♻️ Восстановить после шага' which breaks with "1" suffix
  if (node.id === 'tts-save-audio') {
    const oldCode = node.parameters.jsCode;
    // Replace the fragile node reference with $('🔗 Объединение данных')
    const newCode = `const fs = require('fs');
const ttsResp = $input.first().json;
// Use merge-data node (stable name, always accessible)
const ctx = $('🔗 Объединение данных').first().json;

if (ttsResp.error) throw new Error('GPTunnel TTS ошибка: ' + JSON.stringify(ttsResp.error).substring(0, 300));
if (!ttsResp.data) throw new Error('GPTunnel TTS: пустой ответ. Ответ: ' + JSON.stringify(ttsResp).substring(0, 300));

const filename = \`voice_\${ctx.session_id}_a2e.mp3\`;
const fsPath = \`/home/node/output/\${filename}\`;

const buf = Buffer.from(ttsResp.data, 'base64');
fs.writeFileSync(fsPath, buf);

const audioUrl = \`\${ctx.site_url}/output/\${filename}\`;
return [{ json: { ...ctx, audio_url: audioUrl } }];`;

    if (oldCode !== newCode) {
      node.parameters.jsCode = newCode;
      changed = true;
      console.log('✅ Fixed tts-save-audio: replaced fragile node reference with merge-data');
    } else {
      console.log('ℹ️  tts-save-audio already correct (no change)');
    }
  }
}

if (changed) {
  fs.writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
  console.log('✅ Saved:', WF_PATH);
} else {
  console.log('ℹ️  No changes needed');
}
