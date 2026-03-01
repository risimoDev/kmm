const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});
pool.query("SELECT id, name, active FROM workflow_entity WHERE name LIKE '%04%'")
  .then(r => { r.rows.forEach(x => console.log(x.id, x.name, 'active:', x.active)); return pool.end(); })
  .catch(e => { console.error(e); pool.end(); });
