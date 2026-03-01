// Check if product_cards table has data
const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

async function main() {
  const client = await pool.connect();
  try {
    // Check if table exists
    const exists = await client.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'product_cards')
    `);
    console.log('product_cards table exists:', exists.rows[0].exists);
    
    if (exists.rows[0].exists) {
      const res = await client.query(`SELECT * FROM product_cards ORDER BY id DESC LIMIT 1`);
      if (res.rows.length > 0) {
        const card = res.rows[0];
        console.log('\nLatest card:');
        console.log('  ID:', card.id);
        console.log('  Product:', card.product_name);
        console.log('  Marketplace:', card.marketplace);
        console.log('  Title:', card.main_title);
        console.log('  Status:', card.status);
        // Check a_plus_content for infographic
        if (card.a_plus_content) {
          const aplus = typeof card.a_plus_content === 'string' ? JSON.parse(card.a_plus_content) : card.a_plus_content;
          console.log('  Infographic URL:', aplus.infographic_url || 'NULL');
          console.log('  Seedream error:', aplus.seedream_error || 'NONE');
        }
      } else {
        console.log('No cards found');
      }
    }
    
    // Also check execution data for exec 47
    const exec = await client.query(`SELECT data FROM execution_data WHERE "executionId" = 47`);
    if (exec.rows.length > 0) {
      const arr = JSON.parse(exec.rows[0].data);
      const root = arr[0];
      const resultData = typeof arr[parseInt(root.resultData)] === 'string' 
        ? JSON.parse(arr[parseInt(root.resultData)]) 
        : arr[parseInt(root.resultData)];
      
      console.log('\nExecution 47 resultData:', JSON.stringify(resultData));
      
      if (resultData.lastNodeExecuted) {
        const idx = parseInt(resultData.lastNodeExecuted);
        console.log('lastNodeExecuted:', !isNaN(idx) && arr[idx] ? arr[idx] : resultData.lastNodeExecuted);
      }
      
      // runData nodes
      const rdIdx = parseInt(resultData.runData);
      if (!isNaN(rdIdx) && arr[rdIdx]) {
        const rd = typeof arr[rdIdx] === 'string' ? JSON.parse(arr[rdIdx]) : arr[rdIdx];
        console.log('runData nodes:', Object.keys(rd).map(k => {
          const i = parseInt(k);
          return (!isNaN(i) && arr[i]) ? arr[i] : k;
        }).join(', '));
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => console.error(e));
