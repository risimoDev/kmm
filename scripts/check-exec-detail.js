const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: 5432,
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'adminrisimofloor',
  database: process.env.DB_NAME || 'n8n'
});

(async () => {
  try {
    const res = await pool.query(
      'SELECT data FROM execution_data WHERE "executionId" = $1', [43]
    );
    
    if (res.rows.length === 0) {
      console.log('No execution data found');
      return;
    }
    
    const rawData = res.rows[0].data;
    let parsed;
    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      console.log('Raw data (first 2000):', String(rawData).substring(0, 2000));
      return;
    }
    
    const resultData = parsed.resultData || {};
    
    // Top-level error
    if (resultData.error) {
      console.log('=== TOP LEVEL ERROR ===');
      console.log(JSON.stringify(resultData.error, null, 2));
    }
    
    // Check each node's run data for errors
    const runData = resultData.runData || {};
    for (const [nodeName, nodeRuns] of Object.entries(runData)) {
      for (const run of nodeRuns) {
        if (run.error) {
          console.log(`\n=== ERROR in node: ${nodeName} ===`);
          console.log(JSON.stringify(run.error, null, 2).substring(0, 2000));
        }
        // Show output for AI-related nodes  
        if (nodeName.includes('AI') || nodeName.includes('Запрос')) {
          if (run.data && run.data.main && run.data.main[0]) {
            const items = run.data.main[0];
            for (const item of items) {
              if (item.json) {
                console.log(`\n=== OUTPUT of ${nodeName} ===`);
                const j = item.json;
                if (j.url) console.log('URL:', j.url);
                if (j.body) console.log('Body (200 chars):', j.body.substring(0, 200));
                if (j.error) console.log('Error field:', JSON.stringify(j.error));
                if (j.message) console.log('Message:', j.message);
                // Status code for HTTP response
                const keys = Object.keys(j);
                console.log('Keys:', keys.join(', '));
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.log('Script error:', e.message);
  }
  await pool.end();
  process.exit(0);
})();
