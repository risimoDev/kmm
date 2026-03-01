// Swap old workflow 04 with new one
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
    // Deactivate old workflow
    const r1 = await client.query(`
      UPDATE workflow_entity SET active = false
      WHERE id = '8xRP0MkuO7aTxg6X'
    `);
    console.log('Deactivated old workflow:', r1.rowCount);
    
    // Activate new workflow
    const r2 = await client.query(`
      UPDATE workflow_entity SET active = true
      WHERE id = '2lk1EflFXtEFJOkK'
    `);
    console.log('Activated new workflow:', r2.rowCount);
    
    // Verify
    const res = await client.query(`
      SELECT id, name, active FROM workflow_entity
      WHERE name LIKE '%04%' OR name LIKE '%карточ%'
    `);
    for (const row of res.rows) {
      console.log(`  ${row.id} | active: ${row.active} | ${row.name}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
