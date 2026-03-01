// Check execution 45 error details
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    const res1 = await client.query(`
      SELECT id, status, finished, mode, "startedAt", "stoppedAt", "workflowId"
      FROM execution_entity WHERE id >= 44 ORDER BY id DESC
    `);
    for (const r of res1.rows) {
      console.log(`Exec ${r.id}: status=${r.status} finished=${r.finished} started=${r.startedAt} stopped=${r.stoppedAt} wf=${r.workflowId}`);
    }
    
    // Get latest execution data
    const latestId = res1.rows[0].id;
    console.log('\n--- Parsing execution', latestId, '---');
    
    const res2 = await client.query(`SELECT data FROM execution_data WHERE "executionId" = $1`, [latestId]);
    if (res2.rows.length === 0) { console.log('No execution data'); return; }
    
    const raw = res2.rows[0].data;
    console.log('Data length:', raw.length);
    
    let arr;
    try { arr = JSON.parse(raw); } catch(e) { console.log('Not JSON array'); return; }
    
    const root = arr[0];
    console.log('Root:', JSON.stringify(root));
    
    // Resolve a flatted reference
    function resolve(val, depth = 0) {
      if (depth > 5) return val;
      const idx = parseInt(val);
      if (!isNaN(idx) && typeof val === 'string' && arr[idx] !== undefined) {
        return arr[idx];
      }
      return val;
    }
    
    const resultIdx = parseInt(root.resultData);
    if (isNaN(resultIdx)) return;
    const resultData = typeof arr[resultIdx] === 'string' ? JSON.parse(arr[resultIdx]) : arr[resultIdx];
    console.log('\nresultData:', JSON.stringify(resultData));
    
    if (resultData.error) {
      const errIdx = parseInt(resultData.error);
      if (!isNaN(errIdx) && arr[errIdx]) {
        const errorObj = typeof arr[errIdx] === 'string' ? JSON.parse(arr[errIdx]) : arr[errIdx];
        console.log('\nError fields resolved:');
        for (const [key, val] of Object.entries(errorObj)) {
          const resolved = resolve(val);
          if (typeof resolved === 'string' && resolved.length < 1000) {
            console.log(`  ${key}: ${resolved}`);
          } else {
            console.log(`  ${key}: ${val}`);
          }
        }
      }
    }
    
    if (resultData.lastNodeExecuted) {
      console.log('\nlastNodeExecuted:', resolve(resultData.lastNodeExecuted));
    }
    
    // Check runData keys
    if (resultData.runData) {
      const rdIdx = parseInt(resultData.runData);
      if (!isNaN(rdIdx) && arr[rdIdx]) {
        const runData = typeof arr[rdIdx] === 'string' ? JSON.parse(arr[rdIdx]) : arr[rdIdx];
        console.log('\nrunData keys:', Object.keys(runData).map(k => resolve(k)).join(', '));
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
