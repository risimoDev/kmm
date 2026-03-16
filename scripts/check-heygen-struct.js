const axios = require('axios');
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'n8n',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'adminrisimofloor'
});

async function main() {
  const r = await pool.query("SELECT value FROM app_settings WHERE key='heygen_api_key'");
  const key = r.rows[0]?.value;
  if (!key) { console.log('No HeyGen API key'); return; }
  console.log('Using key:', key.slice(0, 10) + '...');

  const res = await axios.get('https://api.heygen.com/v2/avatars', {
    headers: { 'X-Api-Key': key },
    timeout: 15000
  });

  const avatars = res.data?.data?.avatars || [];
  const talkingPhotos = res.data?.data?.talking_photos || [];
  console.log('Avatars count:', avatars.length);
  console.log('Talking photos count:', talkingPhotos.length);

  if (avatars.length > 0) {
    console.log('\n--- First avatar structure ---');
    const a = avatars[0];
    console.log('Keys:', Object.keys(a).join(', '));
    console.log(JSON.stringify(a, null, 2).slice(0, 1200));
  }

  if (avatars.length > 1) {
    console.log('\n--- Second avatar (just ids) ---');
    const a = avatars[1];
    console.log('avatar_id:', a.avatar_id, '| avatar_name:', a.avatar_name);
    if (a.looks) console.log('looks:', JSON.stringify(a.looks).slice(0, 300));
  }

  console.log('\n--- All avatar IDs and names ---');
  avatars.forEach(a => {
    console.log(`  id="${a.avatar_id}" name="${a.avatar_name}"`);
    if (a.looks && a.looks.length) {
      a.looks.forEach(l => console.log(`    look_id="${l.look_id}" desc="${l.look_description || ''}"`));
    }
  });
}

main().catch(e => {
  console.error('ERROR:', e.message);
  if (e.response) console.error('Response:', JSON.stringify(e.response.data));
  console.error(e.stack);
}).finally(() => pool.end());
