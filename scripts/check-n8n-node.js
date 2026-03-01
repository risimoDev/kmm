// Check actual jsCode of ⏳ Ещё не готово in the active workflow
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, nodes::text as nodes_text
      FROM workflow_entity WHERE id = '8xRP0MkuO7aTxg6X'
    `);
    const nodes = JSON.parse(res.rows[0].nodes_text);
    
    // Find ⏳ Ещё не готово
    const notReady = nodes.find(n => n.name === '⏳ Ещё не готово');
    if (notReady) {
      console.log('Node ID:', notReady.id);
      console.log('Has throw:', notReady.parameters.jsCode.includes('throw'));
      console.log('Has seedream_failed:', notReady.parameters.jsCode.includes('seedream_failed'));
      console.log('\nFull jsCode:');
      console.log(notReady.parameters.jsCode);
    }
    
    // Check node count
    console.log('\n--- Total nodes:', nodes.length);
    console.log('--- Node IDs:', nodes.map(n => n.id).join(', '));
    
    // Check 🔁 Повторить?
    const retry = nodes.find(n => n.name === '🔁 Повторить?');
    console.log('\n🔁 Повторить? exists:', !!retry);
    
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
