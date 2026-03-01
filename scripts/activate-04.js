const {Pool} = require('pg');
const p = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});
p.query("UPDATE workflow_entity SET active = true WHERE id = '8xRP0MkuO7aTxg6X'")
  .then(r => { console.log('Updated:', r.rowCount); return p.end(); })
  .catch(e => { console.error(e); p.end(); });
