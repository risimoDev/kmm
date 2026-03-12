// Query n8n database directly to check workflows and get API key
// Runs on host machine using local pg installation

const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: 'localhost',
    port: 5432,
    database: 'n8n',
    user: 'n8n_user',
    password: 'adminrisimofloor',
  });

  try {
    await c.connect();
    console.log('Connected to PostgreSQL\n');

    // Check workflow count and names
    const wf = await c.query('SELECT id, name, active FROM workflow_entity ORDER BY name LIMIT 20');
    console.log(`=== Workflows (${wf.rowCount} total) ===`);
    wf.rows.forEach(r => console.log(`  [${r.id}] ${r.name} (active=${r.active})`));

    // Check users
    const users = await c.query('SELECT id, email FROM "user" LIMIT 5');
    console.log(`\n=== Users (${users.rowCount}) ===`);
    users.rows.forEach(r => console.log(`  [${r.id}] ${r.email}`));

    // Check API keys
    const keys = await c.query('SELECT id, label, "apiKey" FROM user_api_keys LIMIT 5');
    console.log(`\n=== API Keys (${keys.rowCount}) ===`);
    keys.rows.forEach(r => console.log(`  [${r.id}] ${r.label}: ${r.apiKey}`));

  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.error('pg module not found. Run: npm install pg');
    } else {
      console.error('Error:', e.message);
    }
  } finally {
    await c.end().catch(() => {});
  }
}

main();
