const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '../dashboard/public/index.html'), 'utf8');
const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
let js = m.map(s => s.replace(/<script[^>]*>/, '').replace(/<\/script>/, '')).join('\n');
try {
  new Function(js);
  console.log('SYNTAX OK');
} catch(e) {
  console.error('SYNTAX ERROR:', e.message);
}
