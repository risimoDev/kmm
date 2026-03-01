const { Client } = require('pg');

(async () => {
  const client = new Client({
    host: 'postgres',
    port: 5432,
    user: 'n8n_user',
    password: 'adminrisimofloor',
    database: 'n8n'
  });
  await client.connect();

  // Check recent executions for workflow 04
  const res = await client.query(`
    SELECT id, status, "workflowId", "stoppedAt", 
           LEFT("workflowData"::text, 200) as wf_preview
    FROM execution_entity 
    WHERE "workflowId" = '8xRP0MkuO7aTxg6X'
    ORDER BY id DESC 
    LIMIT 3
  `);
  
  console.log('=== Recent Executions for Workflow 04 ===');
  for (const row of res.rows) {
    console.log(`\nID: ${row.id} | Status: ${row.status} | Stopped: ${row.stoppedAt}`);
  }

  // Get the latest execution data to see the actual error
  if (res.rows.length > 0) {
    const latestId = res.rows[0].id;
    const execData = await client.query(`
      SELECT "executionData" FROM execution_data WHERE "executionId" = $1
    `, [latestId]);
    
    if (execData.rows.length > 0) {
      const data = execData.rows[0].executionData;
      // Parse and look for the error
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const resultData = parsed.resultData || {};
        
        // Check for error
        if (resultData.error) {
          console.log('\n=== EXECUTION ERROR ===');
          console.log(JSON.stringify(resultData.error, null, 2).substring(0, 1000));
        }
        
        // Check run data for the AI analysis node
        const runData = resultData.runData || {};
        for (const [nodeName, nodeRuns] of Object.entries(runData)) {
          if (nodeName.includes('AI') || nodeName.includes('анализ')) {
            console.log(`\n=== Node: ${nodeName} ===`);
            for (const run of nodeRuns) {
              if (run.error) {
                console.log('ERROR:', JSON.stringify(run.error, null, 2).substring(0, 2000));
              }
              if (run.data && run.data.main && run.data.main[0]) {
                const firstItem = run.data.main[0][0];
                if (firstItem && firstItem.json) {
                  console.log('OUTPUT (first 500 chars):', JSON.stringify(firstItem.json).substring(0, 500));
                }
              }
            }
          }
        }
        
        // Also check the build-body node output
        for (const [nodeName, nodeRuns] of Object.entries(runData)) {
          if (nodeName.includes('Запрос') || nodeName.includes('анализ фото')) {
            console.log(`\n=== Node: ${nodeName} ===`);
            for (const run of nodeRuns) {
              if (run.data && run.data.main && run.data.main[0]) {
                const firstItem = run.data.main[0][0];
                if (firstItem && firstItem.json) {
                  const j = firstItem.json;
                  console.log('URL:', j.url);
                  console.log('Body length:', j.body ? j.body.length : 'no body');
                  console.log('Body preview:', j.body ? j.body.substring(0, 300) : 'N/A');
                }
              }
            }
          }
        }
        
      } catch (e) {
        console.log('Parse error:', e.message);
      }
    }
  }
  
  await client.end();
})();
