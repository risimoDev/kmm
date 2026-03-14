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

    // Find Annelore - show ALL fields
    const ann = avatars.find(a => a.avatar_id?.includes('Annelore_public_4'));
    if (ann) {
      console.log('=== Annelore_public_4 FULL DATA ===');
      console.log(JSON.stringify(ann, null, 2));
    }

    // Find an avatar that has looks
    const withLooks = avatars.find(a => a.looks && a.looks.length > 0);
    if (withLooks) {
      console.log('\n=== Avatar WITH looks ===');
      console.log(JSON.stringify(withLooks, null, 2));
    }

    // Show first avatar with ALL fields
    console.log('\n=== First avatar ALL fields ===');
    console.log(JSON.stringify(avatars[0], null, 2));

    // Also check talking photos
    const talkResp = await axios.get('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': key },
      params: { type: 'talking_photo' },
      timeout: 15000
    });
    const talkAvatars = talkResp.data?.data?.avatars || talkResp.data?.data?.talking_photos || [];
    console.log('\n=== Talking photos count ===', talkAvatars.length);
    if (talkAvatars.length > 0) {
      console.log(JSON.stringify(talkAvatars[0], null, 2));
    }

    // Check the keys in the top-level response
    console.log('\n=== Top-level data keys ===', Object.keys(resp.data?.data || {}));

    process.exit(0);
  } catch(e) {
    console.error('Error:', e.response?.data || e.message);
    process.exit(1);
  }
}, 2000);
