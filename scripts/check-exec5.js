const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres', port: 5432,
  user: 'n8n_user', password: 'adminrisimofloor', database: 'n8n'
});

(async () => {
  const r = await pool.query(
    `SELECT data FROM execution_data WHERE "executionId" = 43`
  );
  const text = r.rows[0].data;
  const parsed = JSON.parse(text);
  const rd = parsed.resultData || {};
  
  if (rd.error) {
    console.log('=== TOP ERROR ===');
    console.log(JSON.stringify(rd.error, null, 2).substring(0, 2000));
  }
  
  const runData = rd.runData || {};
  for (const [name, runs] of Object.entries(runData)) {
    for (const run of runs) {
      if (run.error) {
        console.log('\n=== NODE ERROR: ' + name + ' ===');
        console.log(JSON.stringify(run.error, null, 2).substring(0, 2000));
      }
    }
  }
  
  await pool.end();
})();
