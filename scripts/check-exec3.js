const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres',
  port: 5432,
  user: 'n8n_user',
  password: 'adminrisimofloor',
  database: 'n8n'
});

(async () => {
  // 1. Find execution tables
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%execut%'"
  );
  console.log('Execution tables:', tables.rows.map(r => r.table_name));

  // 2. Get columns of execution_entity
  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'execution_entity' ORDER BY ordinal_position"
  );
  console.log('\nexecution_entity columns:', cols.rows.map(r => r.column_name + ':' + r.data_type));

  // 3. Get latest failed execution basic info
  const exec = await pool.query(
    `SELECT id, status, "stoppedAt", "startedAt" FROM execution_entity WHERE status = 'error' ORDER BY id DESC LIMIT 1`
  );
  if (exec.rows.length > 0) {
    console.log('\nLatest failed execution:', exec.rows[0]);
    const execId = exec.rows[0].id;

    // 4. Check execution_data table
    if (tables.rows.some(r => r.table_name === 'execution_data')) {
      const dataCols = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'execution_data'"
      );
      console.log('execution_data columns:', dataCols.rows.map(r => r.column_name));
      
      const data = await pool.query(
        `SELECT * FROM execution_data WHERE "executionId" = $1`, [execId]
      );
      if (data.rows.length > 0) {
        const row = data.rows[0];
        const rawData = row.data || row.workflowData;
        let parsed;
        try {
          parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        } catch(e) {
          console.log('Cannot parse, first 500 chars:', String(rawData).substring(0, 500));
          await pool.end();
          return;
        }
        
        const rd = parsed.resultData || {};
        if (rd.error) {
          console.log('\n=== EXECUTION ERROR ===');
          console.log(JSON.stringify(rd.error, null, 2).substring(0, 1500));
        }
        
        const runData = rd.runData || {};
        for (const [name, runs] of Object.entries(runData)) {
          for (const run of runs) {
            if (run.error) {
              console.log(`\n=== NODE ERROR: ${name} ===`);
              console.log(JSON.stringify(run.error, null, 2).substring(0, 1500));
            }
          }
        }
      } else {
        console.log('No execution_data for id', execId);
      }
    }
  }
  
  await pool.end();
})();
