// Check all workflows for common issues
const fs   = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'workflows');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

let totalIssues = 0;

files.forEach(f => {
  const wf    = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const nodes = wf.nodes || [];
  const issues = [];

  nodes.forEach(n => {
    const params = n.parameters || {};

    // 1. SQL nodes: multi-statement + parameterized queries ($2)
    const query = params.query || '';
    if (typeof query === 'string' && query.includes('$2') && query.includes(';')) {
      issues.push(`SQL with $2 and semicolon in node "${n.name}"`);
    }

    // 2. Code nodes with fragile node name references
    const code = params.jsCode || params.functionCode || '';
    if (typeof code === 'string') {
      // Find $('NodeName') references
      const refs = code.match(/\$\('[^']+'\)/g) || [];
      refs.forEach(ref => {
        // Check for non-stable references (not merge/combine data)
        if (!ref.includes('Объединение данных') && !ref.includes('merge')) {
          issues.push(`Node ref in "${n.name}": ${ref.substring(0, 80)}`);
        }
      });
    }

    // 3. HTTP Request nodes with wrong Authorization header interpolation
    const headers = (params.headerParameters || {}).parameters || [];
    headers.forEach(h => {
      if (h.name === 'Authorization' && typeof h.value === 'string') {
        // Warn if uses {{ }} template instead of = expression
        if (h.value.startsWith('{{ ') && h.value.endsWith(' }}')) {
          issues.push(`HTTP node "${n.name}" uses {{ }} in Authorization (may fail in n8n 2.x)`);
        }
      }
    });
  });

  if (issues.length > 0) {
    console.log(`\n⚠️  ${f}:`);
    issues.forEach(i => console.log(`     • ${i}`));
    totalIssues += issues.length;
  } else {
    console.log(`✅  ${f}`);
  }
});

console.log(`\n=== Total: ${totalIssues} issues found ===`);
