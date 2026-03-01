// Deep extract execution 45 error context + check body construction
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT data FROM execution_data WHERE "executionId" = 45`);
    if (res.rows.length === 0) { console.log('No data'); return; }
    
    const arr = JSON.parse(res.rows[0].data);
    
    // Print elements 4-30 to understand the error
    console.log('=== Elements around error (4-25) ===');
    for (let i = 4; i < Math.min(30, arr.length); i++) {
      let val = arr[i];
      if (typeof val === 'string' && val.length > 200) {
        val = val.substring(0, 200) + '...(' + val.length + ' chars)';
      }
      console.log(`[${i}]: ${JSON.stringify(val)}`);
    }
    
    // Find the build-analysis-body output (the body field)
    console.log('\n=== Looking for request body ===');
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (typeof val === 'string' && val.includes('chat/completions')) {
        console.log(`[${i}]: ${val.substring(0, 300)}`);
      }
      if (typeof val === 'string' && val.includes('"model"') && val.includes('messages')) {
        console.log(`[${i}] (body?): ${val.substring(0, 500)}`);
      }
    }
    
    // Find the HTTP request node data
    console.log('\n=== Looking for AI анализ фото run data ===');
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (typeof val === 'string' && val.includes('AI анализ фото')) {
        console.log(`[${i}]: ${val.substring(0, 300)}`);
      }
    }
    
    // Check credential references
    console.log('\n=== Looking for credential references ===');
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (typeof val === 'string' && (val.includes('httpHeaderAuth') || val.includes('YTA7'))) {
        console.log(`[${i}]: ${val.substring(0, 300)}`);
      }
    }
    
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
