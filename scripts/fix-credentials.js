#!/usr/bin/env node
// ══════════════════════════════════════════════════════════
// fix-credentials.js — Замена hardcoded credential IDs в воркфлоу
//
// Проблема: в JSON-файлах воркфлоу захардкожены ID credentials
// (например "BXL7joPD69X9xNOu"), которые уникальны для каждой
// инсталляции N8N. При деплое на новый сервер воркфлоу ломаются.
//
// Использование:
//   node scripts/fix-credentials.js --list              # показать все credential ID
//   node scripts/fix-credentials.js --map OLD=NEW       # заменить конкретный ID
//   node scripts/fix-credentials.js --interactive       # интерактивная замена
//   node scripts/fix-credentials.js --from-n8n          # авто-маппинг из N8N API
// ══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

// ─── Найти все credential ID во всех воркфлоу ───
function findAllCredentials() {
  const results = [];
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const wf = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    for (const node of (wf.nodes || [])) {
      if (node.credentials) {
        for (const [credType, credInfo] of Object.entries(node.credentials)) {
          results.push({
            file,
            nodeId: node.id,
            nodeName: node.name,
            credType,
            credId: credInfo.id,
            credName: credInfo.name
          });
        }
      }
    }
  }

  return results;
}

// ─── Заменить credential ID в файле ───
function replaceCredentialId(filePath, oldId, newId) {
  let content = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(content);
  let count = 0;

  for (const node of (wf.nodes || [])) {
    if (node.credentials) {
      for (const [credType, credInfo] of Object.entries(node.credentials)) {
        if (credInfo.id === oldId) {
          credInfo.id = newId;
          count++;
        }
      }
    }
  }

  if (count > 0) {
    fs.writeFileSync(filePath, JSON.stringify(wf, null, 2), 'utf8');
  }

  return count;
}

// ─── Команды ───
const args = process.argv.slice(2);
const command = args[0] || '--list';

if (command === '--list') {
  const creds = findAllCredentials();

  if (creds.length === 0) {
    console.log('Credentials не найдены в воркфлоу.');
    process.exit(0);
  }

  // Группируем по ID
  const byId = {};
  for (const c of creds) {
    if (!byId[c.credId]) byId[c.credId] = { name: c.credName, type: c.credType, usages: [] };
    byId[c.credId].usages.push(`${c.file} → ${c.nodeName}`);
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Credential IDs в воркфлоу               ║');
  console.log('╚══════════════════════════════════════════╝\n');

  for (const [id, info] of Object.entries(byId)) {
    const isPlaceholder = id.startsWith('REPLACE_');
    console.log(`  ${isPlaceholder ? '⚠' : '🔑'}  ID: ${id}`);
    console.log(`     Name: ${info.name} (${info.type})`);
    console.log(`     Used in:`);
    for (const usage of info.usages) {
      console.log(`       - ${usage}`);
    }
    if (isPlaceholder) {
      console.log(`     ⚠  Это плейсхолдер — замените на реальный ID credential из N8N`);
    }
    console.log('');
  }

  console.log('Для замены ID:');
  console.log('  node scripts/fix-credentials.js --map OLD_ID=NEW_ID');
  console.log('  node scripts/fix-credentials.js --interactive\n');

} else if (command === '--map') {
  const mapping = args[1];
  if (!mapping || !mapping.includes('=')) {
    console.error('Формат: --map OLD_ID=NEW_ID');
    process.exit(1);
  }

  const [oldId, newId] = mapping.split('=', 2);
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
  let totalReplaced = 0;

  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const count = replaceCredentialId(filePath, oldId, newId);
    if (count > 0) {
      console.log(`  ✓ ${file}: ${count} замен`);
      totalReplaced += count;
    }
  }

  if (totalReplaced === 0) {
    console.log(`  Credential ID "${oldId}" не найден ни в одном воркфлоу.`);
  } else {
    console.log(`\n✅ Заменено ${totalReplaced} ссылок: ${oldId} → ${newId}`);
  }

} else if (command === '--interactive') {
  const creds = findAllCredentials();
  const uniqueIds = [...new Set(creds.map(c => c.credId))];

  if (uniqueIds.length === 0) {
    console.log('Credentials не найдены.');
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nИнтерактивная замена credential IDs\n');

  let idx = 0;
  function next() {
    if (idx >= uniqueIds.length) {
      console.log('\n✅ Готово!');
      rl.close();
      return;
    }

    const oldId = uniqueIds[idx];
    const info = creds.filter(c => c.credId === oldId);
    const name = info[0].credName;
    const count = info.length;

    console.log(`\n[${idx+1}/${uniqueIds.length}] "${name}" (ID: ${oldId}, используется ${count} раз)`);

    rl.question('  Новый ID (Enter — пропустить): ', (newId) => {
      if (newId && newId.trim()) {
        const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
        let replaced = 0;
        for (const file of files) {
          replaced += replaceCredentialId(path.join(WORKFLOWS_DIR, file), oldId, newId.trim());
        }
        console.log(`  ✓ Заменено ${replaced} ссылок`);
      } else {
        console.log('  — Пропущен');
      }
      idx++;
      next();
    });
  }

  next();

} else if (command === '--from-n8n') {
  // Автоматический маппинг по имени credential через N8N API
  const http = require('http');

  const n8nUrl = process.env.N8N_URL || 'http://localhost:5678';
  const apiKey = process.env.N8N_API_KEY || '';

  if (!apiKey) {
    console.error('Задайте N8N_API_KEY для использования этого режима.');
    console.error('  N8N_API_KEY=xxx node scripts/fix-credentials.js --from-n8n');
    process.exit(1);
  }

  const url = `${n8nUrl}/rest/credentials`;
  const headers = { 'X-N8N-API-KEY': apiKey };

  const req = (url.startsWith('https') ? require('https') : http).get(url, { headers }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const n8nCreds = parsed.data || parsed;

        if (!Array.isArray(n8nCreds)) {
          console.error('Неожиданный ответ от N8N API:', data.substring(0, 200));
          process.exit(1);
        }

        // Маппинг по имени
        const nameToId = {};
        for (const c of n8nCreds) {
          nameToId[c.name] = c.id;
        }

        const wfCreds = findAllCredentials();
        const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
        let totalReplaced = 0;

        const processed = new Set();
        for (const wfCred of wfCreds) {
          const key = `${wfCred.credId}:${wfCred.credName}`;
          if (processed.has(key)) continue;
          processed.add(key);

          const n8nId = nameToId[wfCred.credName];
          if (n8nId && n8nId !== wfCred.credId) {
            for (const file of files) {
              const count = replaceCredentialId(path.join(WORKFLOWS_DIR, file), wfCred.credId, n8nId);
              if (count > 0) {
                console.log(`  ✓ "${wfCred.credName}": ${wfCred.credId} → ${n8nId} (${count} замен)`);
                totalReplaced += count;
              }
            }
          } else if (!n8nId) {
            console.log(`  ⚠ "${wfCred.credName}" не найден в N8N — создайте его`);
          }
        }

        if (totalReplaced === 0) {
          console.log('\nВсе credential IDs уже актуальны или credentials не найдены в N8N.');
        } else {
          console.log(`\n✅ Заменено ${totalReplaced} ссылок`);
        }
      } catch (e) {
        console.error('Ошибка парсинга:', e.message);
      }
    });
  });
  req.on('error', (e) => console.error('Ошибка подключения к N8N:', e.message));

} else {
  console.log('Использование:');
  console.log('  node scripts/fix-credentials.js --list');
  console.log('  node scripts/fix-credentials.js --map OLD_ID=NEW_ID');
  console.log('  node scripts/fix-credentials.js --interactive');
  console.log('  node scripts/fix-credentials.js --from-n8n');
}
