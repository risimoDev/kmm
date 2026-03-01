// Copy nodes/connections from new workflow to old, delete new, reactivate old
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    // Get new workflow's nodes and connections
    const res = await client.query(`
      SELECT nodes, connections FROM workflow_entity WHERE id = '2lk1EflFXtEFJOkK'
    `);
    if (res.rows.length === 0) throw new Error('New workflow not found');
    
    const { nodes, connections } = res.rows[0];
    
    // Update old workflow with new nodes and connections
    const upd = await client.query(`
      UPDATE workflow_entity 
      SET nodes = $1::json, connections = $2::json, active = true
      WHERE id = '8xRP0MkuO7aTxg6X'
    `, [JSON.stringify(nodes), JSON.stringify(connections)]);
    console.log('Updated old workflow:', upd.rowCount);
    
    // Delete new workflow
    const del = await client.query(`
      DELETE FROM workflow_entity WHERE id = '2lk1EflFXtEFJOkK'
    `);
    console.log('Deleted new workflow:', del.rowCount);
    
    // Verify
    const verify = await client.query(`
      SELECT id, name, active FROM workflow_entity WHERE name LIKE '%04%'
    `);
    for (const row of verify.rows) {
      console.log(`  ${row.id} | active: ${row.active} | ${row.name}`);
    }

    // Count nodes in old workflow
    const count = await client.query(`
      SELECT id, json_array_length(nodes::json) as node_count
      FROM workflow_entity WHERE id = '8xRP0MkuO7aTxg6X'
    `);
    console.log('Nodes in updated workflow:', count.rows[0].node_count);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
