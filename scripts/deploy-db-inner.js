// Deploy workflows directly via PostgreSQL (bypasses n8n API auth issues)
// Runs INSIDE the n8n container: docker exec content-factory-n8n node /tmp/deploy-db.js
// Or called from host via: docker exec -i content-factory-n8n node /dev/stdin < scripts/deploy-db-inner.js

const fs   = require('fs');
const path = require('path');

// pg lives inside n8n's pnpm store
const pgPath = (function() {
  const candidates = [
    '/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pg@8.12.0/node_modules/pg',
    '/usr/local/lib/node_modules/n8n/node_modules/pg',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p + '/package.json')) return p;
  }
  // fallback: require from n8n's resolution
  return 'pg';
})();
const { Client } = require(pgPath);

const DB = {
  host: 'postgres',
  port: 5432,
  database: 'n8n',
  user: 'n8n_user',
  password: 'adminrisimofloor',
};

// Workflow files available inside the container at /workflows/
const WF_DIR = '/workflows';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node deploy-db-inner.js <workflow-filename.json> [...]');
    process.exit(1);
  }

  const c = new Client(DB);
  await c.connect();
  console.log('Connected to PostgreSQL\n');

  try {
    for (const arg of args) {
      const filePath = path.isAbsolute(arg) ? arg : path.join(WF_DIR, arg);
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        continue;
      }

      const wf = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const { name, nodes, connections, settings, staticData, versionId } = wf;
      if (!name) { console.warn(`No "name" field in ${arg}, skipping`); continue; }

      // Find existing workflow by name
      const existing = await c.query(
        'SELECT id, name FROM workflow_entity WHERE name = $1 LIMIT 1',
        [name]
      );

      if (existing.rowCount === 0) {
        console.log(`  "${name}" not found in DB — cannot create via DB directly. Import it via n8n UI first.`);
        continue;
      }

      const id = existing.rows[0].id;
      console.log(`↻  Updating "${name}" (id=${id})...`);

      await c.query(
        `UPDATE workflow_entity
         SET    nodes       = $1,
                connections = $2,
                settings    = $3,
                "staticData" = $4,
                "updatedAt" = NOW()
         WHERE  id = $5`,
        [
          JSON.stringify(nodes),
          JSON.stringify(connections),
          JSON.stringify(settings || {}),
          staticData ? JSON.stringify(staticData) : null,
          id,
        ]
      );

      console.log(`✅  Updated "${name}" — ${nodes.length} nodes`);
    }
  } finally {
    await c.end();
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
