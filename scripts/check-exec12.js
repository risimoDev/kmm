// Find the image_url used in execution 48
const {Pool} = require('pg');
const p = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

p.query('SELECT data FROM execution_data WHERE "executionId" = 48').then(r => {
  const arr = JSON.parse(r.rows[0].data);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === 'string' && (v.includes('image_url') || v.includes('minio') || v.includes('undefined')) && v.length < 500) {
      console.log(`[${i}]: ${v}`);
    }
  }
  
  // Also search for the messages array sent to GPTunnel
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === 'string' && v.includes('invalid_image') && v.length < 600) {
      console.log(`\n[${i}] ERROR: ${v}`);
    }
  }
  
  p.end();
}).catch(e => { console.error(e); p.end(); });
