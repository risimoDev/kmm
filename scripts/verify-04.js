// Verify workflow 04 was imported correctly
const http = require('http');
const qs = "SELECT w.id, w.name, w.active, length(n.nodes::text) as nodes_len, " +
  "(SELECT count(*) FROM jsonb_array_elements(n.nodes)) as node_count " +
  "FROM workflow_entity w JOIN workflow_entity n ON w.id = n.id " +
  "WHERE w.name LIKE '%04%' OR w.name LIKE '%карточ%';";

const postData = JSON.stringify({query: qs});
// query via psql directly
const { execSync } = require('child_process');

// Just use node-postgres through dashboard's db module
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
    // Check workflow exists and count nodes
    const res = await client.query(`
      SELECT id, name, active,
        (SELECT count(*) FROM jsonb_array_elements(nodes)) as node_count
      FROM workflow_entity
      WHERE name LIKE '%04%' OR name LIKE '%карточ%'
    `);
    
    for (const row of res.rows) {
      console.log(`Workflow: ${row.id} | ${row.name} | active: ${row.active} | nodes: ${row.node_count}`);
    }

    // Check specific node names
    const res2 = await client.query(`
      SELECT elem->>'name' as name, elem->>'id' as node_id
      FROM workflow_entity,
        jsonb_array_elements(nodes) as elem
      WHERE name LIKE '%04%' OR name LIKE '%карточ%'
      ORDER BY elem->>'id'
    `);
    
    console.log('\nAll nodes:');
    for (const row of res2.rows) {
      console.log(`  ${row.node_id}: ${row.name}`);
    }

    // Check the ⏳ Ещё не готово node has no throw
    const res3 = await client.query(`
      SELECT elem->>'id' as id, elem->'parameters'->>'jsCode' as code
      FROM workflow_entity,
        jsonb_array_elements(nodes) as elem
      WHERE (name LIKE '%04%' OR name LIKE '%карточ%')
        AND elem->>'id' = 'not-ready-yet'
    `);
    
    if (res3.rows.length > 0) {
      const code = res3.rows[0].code;
      console.log('\n⏳ Ещё не готово:');
      console.log('  Has throw:', code.includes('throw'));
      console.log('  Has seedream_failed:', code.includes('seedream_failed'));
    }

    // Check connections for new node
    const res4 = await client.query(`
      SELECT connections
      FROM workflow_entity
      WHERE name LIKE '%04%' OR name LIKE '%карточ%'
    `);
    
    if (res4.rows.length > 0) {
      const conns = res4.rows[0].connections;
      console.log('\n🔁 Повторить? connections:', JSON.stringify(conns['🔁 Повторить?'] || 'NOT FOUND'));
      console.log('⏳ Ещё не готово connections:', JSON.stringify(conns['⏳ Ещё не готово'] || 'NOT FOUND'));
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error(e));
