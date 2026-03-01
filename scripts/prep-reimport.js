// Add the n8n workflow ID and reimport
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'workflows', '04-product-card.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Set the ID to match the existing workflow so import:workflow updates it
workflow.id = '8xRP0MkuO7aTxg6X';

// Write a temp file with the ID
const tmpPath = path.join(__dirname, '..', 'workflows', '04-with-id.json');
fs.writeFileSync(tmpPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');

console.log('Written', tmpPath, 'with id:', workflow.id);
console.log('Nodes:', workflow.nodes.length);
