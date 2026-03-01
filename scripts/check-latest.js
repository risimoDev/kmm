const {Pool} = require('pg');
const pool = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});

pool.query('SELECT id, status, finished, "workflowId" FROM execution_entity ORDER BY id DESC LIMIT 5')
  .then(r => {
    r.rows.forEach(x => console.log(x.id, x.status, x.finished, x.workflowId));
    return pool.end();
  })
  .catch(e => { console.error(e); pool.end(); });
