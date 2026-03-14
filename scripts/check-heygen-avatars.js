const axios = require('axios');
const { query } = require('./src/db');

setTimeout(async () => {
  try {
    const r = await query("SELECT value FROM app_settings WHERE key = 'heygen_api_key'");
    const key = r.rows[0]?.value;
    if (!key) { console.log('No HeyGen API key'); process.exit(1); }

    const resp = await axios.get('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': key },
      timeout: 15000
    });

    const avatars = resp.data?.data?.avatars || [];
    console.log('Total avatars:', avatars.length);

    // Show first 3 with full structure
    const sample = avatars.slice(0, 3).map(a => ({
      avatar_id: a.avatar_id,
      avatar_name: a.avatar_name,
      looks: (a.looks || []).map(l => ({ id: l.id, name: l.name, image_url: l.image_url?.substring(0, 50) })),
      talk_count: (a.talks || []).length
    }));
    console.log(JSON.stringify(sample, null, 2));

    // Find Annelore specifically
    const ann = avatars.find(a => a.avatar_id?.includes('Annelore') || a.avatar_name?.includes('Annelore'));
    if (ann) {
      console.log('\n--- Annelore avatar ---');
      console.log(JSON.stringify({
        avatar_id: ann.avatar_id,
        avatar_name: ann.avatar_name,
        looks: ann.looks,
        talks: ann.talks?.slice(0, 2)
      }, null, 2));
    }

    process.exit(0);
  } catch(e) {
    console.error('Error:', e.response?.data || e.message);
    process.exit(1);
  }
}, 2000);
