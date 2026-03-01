// Check execution 46 error details
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    const res1 = await client.query(`
      SELECT id, status, finished, mode, "startedAt", "stoppedAt", "workflowId"
      FROM execution_entity WHERE id = 46
    `);
    console.log('Execution 46:', JSON.stringify(res1.rows[0], null, 2));
    
    const res2 = await client.query(`SELECT data FROM execution_data WHERE "executionId" = 46`);
    if (res2.rows.length === 0) { console.log('No execution data'); return; }
    
    const arr = JSON.parse(res2.rows[0].data);
    const root = arr[0];
    console.log('Root:', JSON.stringify(root));
    
    const resultData = typeof arr[parseInt(root.resultData)] === 'string' 
      ? JSON.parse(arr[parseInt(root.resultData)]) 
      : arr[parseInt(root.resultData)];
    console.log('resultData:', JSON.stringify(resultData));
    
    // error
    if (resultData.error) {
      const errObj = arr[parseInt(resultData.error)];
      const parsed = typeof errObj === 'string' ? JSON.parse(errObj) : errObj;
      console.log('\nError:');
      for (const [k, v] of Object.entries(parsed)) {
        const idx = parseInt(v);
        if (!isNaN(idx) && arr[idx] && typeof arr[idx] === 'string' && arr[idx].length < 1000) {
          console.log(`  ${k}: ${arr[idx]}`);
        } else {
          console.log(`  ${k}: ${v}`);
        }
      }
    }
    
    // lastNodeExecuted
    if (resultData.lastNodeExecuted) {
      const idx = parseInt(resultData.lastNodeExecuted);
      console.log('\nlastNodeExecuted:', !isNaN(idx) && arr[idx] ? arr[idx] : resultData.lastNodeExecuted);
    }
    
    // runData keys
    const rdIdx = parseInt(resultData.runData);
    if (!isNaN(rdIdx) && arr[rdIdx]) {
      const rd = typeof arr[rdIdx] === 'string' ? JSON.parse(arr[rdIdx]) : arr[rdIdx];
      const keys = Object.keys(rd).map(k => {
        const i = parseInt(k);
        return (!isNaN(i) && arr[i]) ? arr[i] : k;
      });
      console.log('\nrunData nodes:', keys.join(', '));
    }
    
    // Find the error message (search for specific strings)
    console.log('\n=== Searching for error message ===');
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (typeof val === 'string' && (val.includes('400') || val.includes('error') || val.includes('failed') || val.includes('Seedream')) && val.length > 10 && val.length < 500) {
        console.log(`[${i}]: ${val}`);
      }
    }
    
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
