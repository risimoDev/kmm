/**
 * Fix workflow 04-product-card.json:
 * 1. Strip Midjourney flags from Seedream prompts
 * 2. Update AI prompt to instruct no MJ flags in infographic_prompts
 * 3. Graceful Seedream failure handling (save card without infographic)
 * 4. Add retry/fail branching IF node
 * 5. Update connections
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'workflows', '04-product-card.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

function findNode(id) {
  return workflow.nodes.find(n => n.id === id);
}

// ────────────────────────────────────────────────
// 1. Update AI prompt — add instruction about no MJ flags in infographic_prompts
// ────────────────────────────────────────────────
const buildBody = findNode('build-analysis-body');
buildBody.parameters.jsCode = buildBody.parameters.jsCode.replace(
  '"infographic_prompts": [\\n    "Промпт для генерации инфографики слайда 1 (детальное описание на АНГЛИЙСКОМ для Seedream 3)",\\n    "Промпт для генерации инфографики слайда 2 (на АНГЛИЙСКОМ)",\\n    "Промпт для генерации инфографики слайда 3 (на АНГЛИЙСКОМ)"\\n  ],',
  '"infographic_prompts": [\\n    "Prompt in English for Seedream 3: detailed visual description, NO --ar/--v/--style flags",\\n    "Prompt in English for Seedream 3: visual description of infographic, no CLI flags",\\n    "Prompt in English for Seedream 3: visual scene description, no flags"\\n  ],'
);

// ────────────────────────────────────────────────
// 2. Update 🎨 Промпт Seedream — strip Midjourney flags
// ────────────────────────────────────────────────
const seedreamPromptNode = findNode('build-seedream-prompt');
seedreamPromptNode.parameters.jsCode = [
  "const ctx = $input.first().json;",
  "const cardData = ctx.card_data;",
  "const prompts = cardData.infographic_prompts || [];",
  "",
  "// Берём 1-й промпт или генерируем дефолтный",
  "let mainPrompt = prompts[0]",
  "  || 'Professional product infographic for ' + ctx.product_name + ' on marketplace ' + ctx.marketplace + '. ' + (cardData.visual_style_notes || 'Modern clean design') + '. Bright colors, clear layout, selling format, vertical orientation.';",
  "",
  "// Убираем Midjourney-флаги (--ar, --v и т.д.) — Seedream принимает ar в теле запроса",
  "mainPrompt = mainPrompt.replace(/\\s*--[a-z]+\\s+[\\w:.]+/gi, '').trim();",
  "",
  "return [{ json: {",
  "  ...ctx,",
  "  seedream_prompt: mainPrompt,",
  "  all_infographic_prompts: prompts",
  "}}];"
].join('\n');

// ────────────────────────────────────────────────
// 3. Update ⏳ Ещё не готово — graceful failure (no throw)
// ────────────────────────────────────────────────
const notReadyNode = findNode('not-ready-yet');
notReadyNode.parameters.jsCode = [
  "const ctx = $('🔑 Извлечь task_id').first().json;",
  "const statusResp = $input.first().json;",
  "",
  "const status = (statusResp.status || '').toLowerCase();",
  "if (status === 'fail' || status === 'failed' || status === 'error') {",
  "  // Seedream не смог — продолжаем без инфографики",
  "  return [{ json: {",
  "    seedream_failed: true,",
  "    seedream_error: JSON.stringify(statusResp).substring(0, 500),",
  "    task_id: ctx.task_id,",
  "    media_base_url: ctx.media_base_url",
  "  }}];",
  "}",
  "",
  "let pollCount = 0;",
  "try { pollCount = $('⏳ Ещё не готово').first().json.poll_count || 0; } catch(e) {}",
  "pollCount++;",
  "",
  "if (pollCount > 40) {",
  "  return [{ json: {",
  "    seedream_failed: true,",
  "    seedream_error: 'Timeout after ' + (pollCount * 15) + ' seconds',",
  "    task_id: ctx.task_id,",
  "    media_base_url: ctx.media_base_url",
  "  }}];",
  "}",
  "",
  "return [{ json: {",
  "  task_id: ctx.task_id,",
  "  media_base_url: ctx.media_base_url,",
  "  poll_count: pollCount,",
  "  seedream_failed: false",
  "}}];"
].join('\n');

// ────────────────────────────────────────────────
// 4. Update 📎 Собрать результат — handle null infographic
// ────────────────────────────────────────────────
const collectResult = findNode('collect-result');
collectResult.parameters.jsCode = [
  "const statusResp = $input.first().json;",
  "const ctx = $('🎨 Промпт Seedream').first().json;",
  "",
  "// Поддержка: Seedream успех ИЛИ Seedream не смог (seedream_failed=true)",
  "const seedreamFailed = statusResp.seedream_failed || false;",
  "const imageUrl = statusResp.url || null;",
  "",
  "if (!imageUrl && !seedreamFailed) {",
  "  throw new Error('Seedream returned done but no URL: ' + JSON.stringify(statusResp).substring(0, 300));",
  "}",
  "",
  "const aPlusContent = {",
  "  ...(ctx.card_data.a_plus_content || {}),",
  "  infographic_url: imageUrl,",
  "  seedream_task_id: statusResp.id || null",
  "};",
  "",
  "if (seedreamFailed) {",
  "  aPlusContent.seedream_error = statusResp.seedream_error || 'Seedream generation failed';",
  "}",
  "",
  "return [{ json: {",
  "  product_name: ctx.product_name,",
  "  image_url: ctx.image_url,",
  "  marketplace: ctx.marketplace,",
  "  artikuls: ctx.artikuls,",
  "  session_id: ctx.session_id,",
  "  callback_url: ctx.callback_url,",
  "  style: ctx.style,",
  "  color_scheme: ctx.color_scheme,",
  "  include_price: ctx.include_price,",
  "  price: ctx.price,",
  "  include_badge: ctx.include_badge,",
  "  badge_text: ctx.badge_text,",
  "  card_data: ctx.card_data,",
  "  a_plus_content_merged: aPlusContent,",
  "  infographic_url: imageUrl",
  "}}];"
].join('\n');

// ────────────────────────────────────────────────
// 5. Add new IF node 🔁 Повторить?
// ────────────────────────────────────────────────
workflow.nodes.push({
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": false,
        "leftValue": "",
        "typeValidation": "strict"
      },
      "conditions": [
        {
          "id": "check-failed",
          "leftValue": "={{ $json.seedream_failed }}",
          "rightValue": true,
          "operator": {
            "type": "boolean",
            "operation": "equals"
          }
        }
      ],
      "combinator": "and"
    },
    "options": {}
  },
  "id": "check-retry",
  "name": "🔁 Повторить?",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2,
  "position": [3680, 720]
});

// ────────────────────────────────────────────────
// 6. Update connections
// ────────────────────────────────────────────────

// ⏳ Ещё не готово → 🔁 Повторить? (instead of → ⏳ Ждать 15 сек)
workflow.connections["⏳ Ещё не готово"] = {
  "main": [
    [
      { "node": "🔁 Повторить?", "type": "main", "index": 0 }
    ]
  ]
};

// 🔁 Повторить? output 0 (seedream_failed=true) → 📎 Собрать результат
// 🔁 Повторить? output 1 (seedream_failed=false) → ⏳ Ждать 15 сек
workflow.connections["🔁 Повторить?"] = {
  "main": [
    [
      { "node": "📎 Собрать результат", "type": "main", "index": 0 }
    ],
    [
      { "node": "⏳ Ждать 15 сек", "type": "main", "index": 0 }
    ]
  ]
};

// ────────────────────────────────────────────────
// Write back
// ────────────────────────────────────────────────
fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');

console.log('✅ Workflow 04 updated:');
console.log('  - AI prompt: infographic_prompts instruction updated (no MJ flags)');
console.log('  - 🎨 Промпт Seedream: strips --ar/--v/--style flags');
console.log('  - ⏳ Ещё не готово: graceful failure (no throw)');
console.log('  - 📎 Собрать результат: handles null infographic');
console.log('  - New node: 🔁 Повторить? (IF branch on seedream_failed)');
console.log('  - Connections updated: failure → save card without infographic');
console.log('  - Total nodes:', workflow.nodes.length);
console.log('  - Connections:', Object.keys(workflow.connections).length);
