// Extract the actual HTTP request that n8n sent to GPTunnel
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT data FROM execution_data WHERE "executionId" = 45`);
    const arr = JSON.parse(res.rows[0].data);
    
    // [16] = context = {"itemIndex":0,"request":"34"}
    // [34] = the actual HTTP request object
    console.log('=== Request object (arr[34]) ===');
    let r34 = arr[34];
    if (typeof r34 === 'string') {
      try { r34 = JSON.parse(r34); } catch(e) {}
    }
    console.log(typeof r34 === 'string' ? r34.substring(0, 1000) : JSON.stringify(r34, null, 2).substring(0, 1000));
    
    // Show elements 34-70
    console.log('\n=== Elements 34-70 ===');
    for (let i = 34; i < Math.min(71, arr.length); i++) {
      let val = arr[i];
      if (typeof val === 'string' && val.length > 300) {
        val = val.substring(0, 300) + '...(' + val.length + ' chars)';
      }
      console.log(`[${i}]: ${JSON.stringify(val)}`);
    }
    
    // Check the body at 163
    console.log('\n=== Body [163] (first 1000 chars) ===');
    if (arr[163]) {
      console.log(typeof arr[163] === 'string' ? arr[163].substring(0, 1000) : JSON.stringify(arr[163]).substring(0, 1000));
    }
    
    // Check what node 🏗️ Запрос анализа фото output looks like
    // [29] = runData entry for build-analysis-body
    console.log('\n=== 🏗️ Запрос анализа фото runData (arr[29]) ===');
    let r29 = arr[29];
    if (typeof r29 === 'string') {
      try { r29 = JSON.parse(r29); } catch(e) {}
    }
    console.log(typeof r29 === 'string' ? r29.substring(0, 500) : JSON.stringify(r29).substring(0, 500));
    
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
