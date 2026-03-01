const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres', port: 5432,
  user: 'n8n_user', password: 'adminrisimofloor', database: 'n8n'
});

// n8n uses flatted to serialize execution data
// flatted is a JSON format where references are stored as string indices
const Flatted = {
  parse(text) {
    const json = JSON.parse(text);
    const $ = json;
    
    function revive(value) {
      if (typeof value === 'string' && /^\d+$/.test(value)) {
        const idx = parseInt(value);
        if (idx < $.length && idx > 0) {
          const ref = $[idx];
          if (typeof ref === 'object' && !Array.isArray(ref)) {
            return ref; // Already an object
          }
          return ref;
        }
      }
      return value;
    }
    
    // Just return the top-level structure with reference resolution
    return $;
  }
};

pool.query('SELECT data FROM execution_data WHERE "executionId" = 43')
  .then(r => {
    const raw = r.rows[0].data;
    const arr = JSON.parse(raw);
    
    // flatted format: arr[0] is the root structure with references
    // References are string numbers pointing to other array elements
    
    // Find error-related text in ALL elements
    for (let i = 0; i < arr.length; i++) {
      const item = typeof arr[i] === 'string' ? arr[i] : JSON.stringify(arr[i]);
      if (item && (
        item.toLowerCase().includes('bad request') ||
        item.toLowerCase().includes('bad_request') ||
        item.includes('please check') ||
        item.includes('NodeApiError') ||
        item.includes('NodeOperationError') ||
        (item.includes('error') && item.length < 200 && item.length > 5)
      )) {
        console.log(`[${i}]: ${item.substring(0, 300)}`);
      }
    }
    
    // Also get the error object referenced from root
    console.log('\n=== ROOT STRUCTURE ===');
    console.log(JSON.stringify(arr[0]).substring(0, 200));
    
    // Error is at arr[4] based on "error":"4"
    console.log('\n=== ERROR OBJECT (arr[4]) ===');
    console.log(JSON.stringify(arr[4]));
    
    // Resolve error fields
    const errObj = arr[4];
    if (errObj && typeof errObj === 'object') {
      for (const [key, val] of Object.entries(errObj)) {
        const resolved = typeof val === 'string' && /^\d+$/.test(val) ? arr[parseInt(val)] : val;
        console.log(`  ${key}: ${typeof resolved === 'string' ? resolved.substring(0, 300) : JSON.stringify(resolved)}`);
      }
    }
    
    // Get last node executed (arr[6])
    console.log('\n=== LAST NODE EXECUTED ===');
    console.log(arr[6]);

    pool.end().then(() => process.exit(0));
  })
  .catch(e => {
    console.log('ERR:', e.message);
    pool.end().then(() => process.exit(1));
  });
