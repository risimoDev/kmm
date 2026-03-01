// Verify workflow 04 was imported correctly - simpler query
const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres',
  port: 5432,
  user: 'n8n_user',
  password: 'adminrisimofloor',
  database: 'n8n'
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, name, active, nodes::text as nodes_text, connections::text as conns_text
      FROM workflow_entity
      WHERE name LIKE '%04%' OR name LIKE '%карточ%'
    `);
    
    for (const row of res.rows) {
      const nodes = JSON.parse(row.nodes_text);
      const conns = JSON.parse(row.conns_text);
      
      console.log(`Workflow: ${row.id} | ${row.name} | active: ${row.active} | nodes: ${nodes.length}`);
      console.log('\nAll nodes:');
      nodes.forEach(n => console.log(`  ${n.id}: ${n.name} (${n.type})`));
      
      // Check ⏳ Ещё не готово
      const notReady = nodes.find(n => n.id === 'not-ready-yet');
      if (notReady) {
        console.log('\n⏳ Ещё не готово:');
        console.log('  Has throw:', notReady.parameters.jsCode.includes('throw'));
        console.log('  Has seedream_failed:', notReady.parameters.jsCode.includes('seedream_failed'));
      }
      
      // Check 🎨 Промпт Seedream
      const prompt = nodes.find(n => n.id === 'build-seedream-prompt');
      if (prompt) {
        console.log('\n🎨 Промпт Seedream:');
        console.log('  Has MJ strip:', prompt.parameters.jsCode.includes('--[a-z]+'));
        console.log('  Has 9:16:', prompt.parameters.jsCode.includes('9:16'));
      }
      
      // Check 🔁 Повторить?
      const retry = nodes.find(n => n.id === 'check-retry');
      console.log('\n🔁 Повторить? node:', retry ? 'EXISTS' : 'MISSING');
      
      // Check connections
      console.log('\n⏳ Ещё не готово →', JSON.stringify(conns['⏳ Ещё не готово']));
      console.log('🔁 Повторить? →', JSON.stringify(conns['🔁 Повторить?']));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error(e));
