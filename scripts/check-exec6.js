const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres', port: 5432,
  user: 'n8n_user', password: 'adminrisimofloor', database: 'n8n'
});

pool.query('SELECT data FROM execution_data WHERE "executionId" = 43')
  .then(r => {
    if (!r.rows.length) { console.log('NO DATA'); process.exit(0); }
    const raw = r.rows[0].data;
    console.log('TYPE:', typeof raw);
    console.log('LEN:', raw.length);
    // Show first 500 chars
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
    console.log('FIRST 300:', str.substring(0, 300));
    // Find "error" keyword
    const idx = str.indexOf('"error"');
    if (idx > -1) {
      console.log('\nERROR CONTEXT:', str.substring(Math.max(0, idx - 50), idx + 500));
    }
    // Find "Bad" keyword
    const bidx = str.indexOf('Bad');
    if (bidx > -1) {
      console.log('\nBAD CONTEXT:', str.substring(Math.max(0, bidx - 100), bidx + 200));
    }
    // Find "400" 
    const fidx = str.indexOf('400');
    if (fidx > -1) {
      console.log('\n400 CONTEXT:', str.substring(Math.max(0, fidx - 100), fidx + 200));
    }
    pool.end().then(() => process.exit(0));
  })
  .catch(e => {
    console.log('ERR:', e.message);
    pool.end().then(() => process.exit(1));
  });
