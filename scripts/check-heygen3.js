const axios = require('axios');
const { query } = require('./src/db');

setTimeout(async () => {
  try {
    const r = await query("SELECT value FROM app_settings WHERE key = 'heygen_api_key'");
    const key = r.rows[0]?.value;
    if (!key) { console.log('No HeyGen API key'); process.exit(1); }

    // Check what's in talking_photos
    const resp = await axios.get('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': key },
      timeout: 15000
    });

    const data = resp.data?.data || {};
    console.log('Keys in response.data:', Object.keys(data));
    console.log('avatars count:', (data.avatars || []).length);
    console.log('talking_photos count:', (data.talking_photos || []).length);

    // Show first talking photo
    const tp = (data.talking_photos || []);
    if (tp.length > 0) {
      console.log('\n=== First talking_photo ===');
      console.log(JSON.stringify(tp[0], null, 2));
      // Find one with UUID-like ID
      const uuid = tp.find(t => /^[0-9a-f]{20,}$/.test(t.talking_photo_id || t.avatar_id || ''));
      if (uuid) {
        console.log('\n=== UUID-format talking_photo ===');
        console.log(JSON.stringify(uuid, null, 2));
      }
    }

    // Also check the avatar group list for interactive avatars
    try {
      const groupResp = await axios.get('https://api.heygen.com/v1/avatar.list', {
        headers: { 'X-Api-Key': key },
        timeout: 15000
      });
      const gData = groupResp.data?.data || {};
      console.log('\n=== v1 avatar.list keys ===', Object.keys(gData));
      const avatarGroups = gData.avatar_list || gData.avatars || [];
      console.log('v1 avatar count:', avatarGroups.length);
      if (avatarGroups.length > 0) {
        // Find Annelore in v1
        const annV1 = avatarGroups.find(a => JSON.stringify(a).includes('Annelore'));
        if (annV1) {
          console.log('\n=== Annelore in v1 ===');
          console.log(JSON.stringify(annV1, null, 2));
        } else {
          console.log('\n=== First v1 avatar ===');
          console.log(JSON.stringify(avatarGroups[0], null, 2));
        }
      }
    } catch(e) {
      console.log('v1 avatar.list error:', e.response?.status, e.response?.data?.message || e.message);
    }

    process.exit(0);
  } catch(e) {
    console.error('Error:', e.response?.data || e.message);
    process.exit(1);
  }
}, 2000);
