const {Pool} = require('pg');
const p = new Pool({host:'postgres',port:5432,user:'n8n_user',password:'adminrisimofloor',database:'n8n'});
p.query("SELECT nodes::text as n FROM workflow_entity WHERE id='8xRP0MkuO7aTxg6X'").then(r => {
  const nodes = JSON.parse(r.rows[0].n);
  const sp = nodes.find(n => n.id === 'build-seedream-prompt');
  console.log('Has MJ strip regex:', sp.parameters.jsCode.includes('--[a-z]+'));
  console.log('\nFull jsCode:');
  console.log(sp.parameters.jsCode);
  p.end();
}).catch(e => { console.error(e); p.end(); });
