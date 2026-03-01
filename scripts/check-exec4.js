const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres', port: 5432,
  user: 'n8n_user', password: 'adminrisimofloor', database: 'n8n'
});

(async () => {
  try {
    // Get data type
    const dt = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'execution_data' AND column_name = 'data'"
    );
    console.log('data column type:', dt.rows[0]);

    // Get raw data - just the error part using JSON extraction if jsonb
    const r = await pool.query(
      `SELECT pg_column_size(data) as data_size FROM execution_data WHERE "executionId" = 43`
    );
    console.log('Data size:', r.rows[0]);

    // Try to extract just the error from JSON
    const r2 = await pool.query(`
      SELECT 
        data->'resultData'->'error' as top_error,
        jsonb_object_keys(COALESCE(data->'resultData'->'runData', '{}'::jsonb)) as node_name
      FROM execution_data 
      WHERE "executionId" = 43
    `);
    console.log('Top error:', r2.rows[0] ? r2.rows[0].top_error : 'none');
    console.log('Nodes ran:', r2.rows.map(r => r.node_name));
  } catch(e) {
    console.log('Error:', e.message);
    
    // Fallback: try simple text extraction
    try {
      const r3 = await pool.query(
        `SELECT LEFT(data::text, 5000) as snippet FROM execution_data WHERE "executionId" = 43`
      );
      if (r3.rows.length > 0) {
        const text = r3.rows[0].snippet;
        // Find error-related parts
        const errorMatch = text.match(/"error":\s*\{[^}]*\}/);
        if (errorMatch) console.log('Error found:', errorMatch[0]);
        const msgMatch = text.match(/"message":"[^"]*Bad[^"]*"/gi);
        if (msgMatch) console.log('Bad request match:', msgMatch[0]);
      }
    } catch(e2) {
      console.log('Fallback error:', e2.message);
    }
  }
  
  await pool.end();
})();
