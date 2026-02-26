#!/usr/bin/env node
// Patch 02c-video-factory-a2e.json:
// 1. Add balance check nodes
// 2. Fix poll_count bug (reads from static node → reads from current item)
// 3. Fix SQL injection in finalize (string interpolation → queryParams)
// 4. Update connections

const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, '..', 'workflows', '02c-video-factory-a2e.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

// ──────────────────────────────────────
// 1. Add balance check + validate nodes
// ──────────────────────────────────────

const balanceCheckNode = {
  parameters: {
    method: 'POST',
    url: '={{ $json.a2e_base_url }}/api/v1/user/remainingCoins',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    options: { timeout: 15000 }
  },
  id: 'check-balance-a2e',
  name: '💰 Проверка баланса',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1060, 400],
  credentials: { httpHeaderAuth: { id: 'REPLACE_A2E_CRED_ID', name: 'A2E API' } },
  onError: 'continueRegularOutput'
};

const validateBalanceCode = [
  "const ctx = $('🔗 Объединение данных').first().json;",
  "const balanceResp = $input.first().json;",
  "",
  "// Проверяем баланс A2E (если API ответил)",
  "const coins = balanceResp?.data?.remainingCoins ?? balanceResp?.data ?? null;",
  "if (coins !== null && typeof coins === 'number' && coins < 10) {",
  "  throw new Error('A2E баланс слишком низкий: ' + coins + ' coins. Пополните аккаунт.');",
  "}",
  "",
  "return [{ json: { ...ctx, a2e_balance: coins } }];"
].join('\n');

const validateBalanceNode = {
  parameters: { jsCode: validateBalanceCode },
  id: 'validate-balance-a2e',
  name: '⚖️ Проверка коинов',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1060, 560]
};

// Insert after merge-a2e
const mergeIdx = wf.nodes.findIndex(n => n.id === 'merge-a2e');
if (mergeIdx === -1) throw new Error('merge-a2e node not found');
wf.nodes.splice(mergeIdx + 1, 0, balanceCheckNode, validateBalanceNode);

console.log('✓ Added balance check nodes after merge-a2e');

// ──────────────────────────────────────
// 2. Fix poll_count bug in retry-a2e
// ──────────────────────────────────────

const retryNode = wf.nodes.find(n => n.id === 'retry-a2e');
if (!retryNode) throw new Error('retry-a2e node not found');

const retryCode = [
  "const prev = $input.first().json;",
  "const statusData = prev.data?.[0] || {};",
  "const status = (statusData.status || 'unknown').toLowerCase();",
  "",
  "// Немедленная остановка при ошибке",
  "if (status === 'fail' || status === 'error' || status === 'failed') {",
  "  throw new Error('A2E генерация провалилась: ' + JSON.stringify(statusData));",
  "}",
  "",
  "// Счётчик poll — читаем из ТЕКУЩЕГО item, а не из статической ноды",
  "const pollCount = (prev.poll_count || 0) + 1;",
  "if (pollCount > 90) {",
  "  throw new Error('A2E timeout: ' + pollCount + ' polls (' + Math.round(pollCount * 20 / 60) + ' min)');",
  "}",
  "",
  "return [{ json: {",
  "  video_id: prev.video_id || $('🔑 Извлечь video_id').first().json.video_id,",
  "  session_id: prev.session_id || $('🔑 Извлечь video_id').first().json.session_id,",
  "  a2e_base_url: prev.a2e_base_url || $('🔑 Извлечь video_id').first().json.a2e_base_url,",
  "  poll_count: pollCount",
  "}}];"
].join('\n');

retryNode.parameters.jsCode = retryCode;
console.log('✓ Fixed poll_count bug in retry-a2e');

// ──────────────────────────────────────
// 3. Fix SQL injection in finalize-a2e
// ──────────────────────────────────────

const finalizeNode = wf.nodes.find(n => n.id === 'finalize-a2e');
if (!finalizeNode) throw new Error('finalize-a2e node not found');

finalizeNode.parameters.query = [
  "UPDATE pipeline_sessions SET",
  "  status = 'ready_for_review',",
  "  current_step = 'review',",
  "  raw_video_url = $1,",
  "  final_video_url = $1,",
  "  updated_at = NOW()",
  "WHERE id = {{ $json.session_id }};",
  "",
  "UPDATE pipeline_steps SET status = 'completed', completed_at = NOW()",
  "WHERE session_id = {{ $json.session_id }} AND step_name = 'a2e_video';"
].join('\n');
finalizeNode.parameters.options = { queryParams: '={{ $json.raw_video_url }}' };

console.log('✓ Fixed SQL injection in finalize-a2e (using queryParams)');

// ──────────────────────────────────────
// 4. Update connections
// ──────────────────────────────────────

// merge -> balance check -> validate -> step-tts
wf.connections['🔗 Объединение данных'] = {
  main: [[{ node: '💰 Проверка баланса', type: 'main', index: 0 }]]
};
wf.connections['💰 Проверка баланса'] = {
  main: [[{ node: '⚖️ Проверка коинов', type: 'main', index: 0 }]]
};
wf.connections['⚖️ Проверка коинов'] = {
  main: [[{ node: '📌 Шаг → TTS', type: 'main', index: 0 }]]
};

console.log('✓ Updated connections: merge → balance → validate → TTS');

// ──────────────────────────────────────
// Write result
// ──────────────────────────────────────

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf8');
console.log(`\n✅ Workflow saved: ${wf.nodes.length} nodes, ${Object.keys(wf.connections).length} connections`);
