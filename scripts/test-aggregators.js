/**
 * Тестирование подключения к российским AI-агрегаторам
 * 
 * Этот скрипт проверяет доступность и работоспособность API агрегаторов:
 * - GoGPT.ru
 * - GPTunnel.ru
 * - AI/ML API (AIMLAPI.com)
 * - OpenRouter
 */

require('dotenv').config();
const https = require('https');
const http = require('http');

// Цвета для консоли
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

console.log(`${colors.cyan}
╔══════════════════════════════════════════════════════════════╗
║   🧪 ТЕСТИРОВАНИЕ РОССИЙСКИХ AI-АГРЕГАТОРОВ                  ║
║   Проект: Контент Завод                                      ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}`);

// Список агрегаторов для тестирования
const aggregators = [
  {
    name: 'GoGPT.ru',
    keyEnv: 'GOGPT_API_KEY',
    url: process.env.GOGPT_BASE_URL || 'https://api.gogpt.ru/v1',
    endpoint: '/models',
    description: 'Подписка от ₽699/мес, 30+ моделей, Telegram-бот',
    docs: 'https://gogpt.ru/',
  },
  {
    name: 'GPTunnel.ru',
    keyEnv: 'GPTUNNEL_API_KEY',
    url: process.env.GPTUNNEL_BASE_URL || 'https://gptunnel.ru/v1',
    endpoint: '/models',
    authFormat: 'raw',
    description: 'Pay-as-you-go от ₽50, 100+ моделей, OpenAI-compatible',
    docs: 'https://gptunnel.ru/',
  },
  {
    name: 'AI/ML API',
    keyEnv: 'AIMLAPI_API_KEY',
    url: process.env.AIMLAPI_BASE_URL || 'https://api.aimlapi.com/v1',
    endpoint: '/models',
    description: '400+ моделей, криптовалюта, edge computing',
    docs: 'https://aimlapi.com/',
  },
  {
    name: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    url: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    endpoint: '/models',
    description: '300+ моделей, 60+ провайдеров, лучший uptime',
    docs: 'https://openrouter.ai/',
  },
];

/**
 * Проверка доступности API агрегатора
 */
async function testAggregator(agg) {
  return new Promise((resolve) => {
    const apiKey = process.env[agg.keyEnv];
    
    console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.cyan}🔍 Тестирование: ${agg.name}${colors.reset}`);
    console.log(`${colors.yellow}   ${agg.description}${colors.reset}`);
    console.log(`   Документация: ${agg.docs}`);
    
    // Проверка наличия API ключа
    if (!apiKey || apiKey === `your_${agg.keyEnv.toLowerCase()}_here` || apiKey.startsWith('your_') || apiKey.startsWith('sk-')) {
      console.log(`${colors.yellow}   ⚠️  API ключ не настроен в .env файле${colors.reset}`);
      console.log(`   Переменная: ${agg.keyEnv}`);
      console.log(`${colors.yellow}   ℹ️  Получите ключ на ${agg.docs}${colors.reset}`);
      resolve({ success: false, reason: 'no_key' });
      return;
    }
    
    console.log(`${colors.green}   ✓ API ключ найден${colors.reset}`);
    console.log(`   Проверяем: ${agg.url}${agg.endpoint}`);
    
    // Парсим URL
    const urlObj = new URL(agg.url + agg.endpoint);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: agg.endpoint,
      method: 'GET',
      headers: {
        'Authorization': agg.authFormat === 'raw' ? apiKey : `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 секунд
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`${colors.green}   ✓ Подключение успешно!${colors.reset}`);
          console.log(`   HTTP Status: ${res.statusCode}`);
          
          try {
            const parsed = JSON.parse(data);
            if (parsed.data && Array.isArray(parsed.data)) {
              console.log(`${colors.green}   ✓ Найдено моделей: ${parsed.data.length}${colors.reset}`);
              
              // Показываем первые 5 моделей
              const topModels = parsed.data.slice(0, 5);
              console.log(`   Доступные модели (первые 5):`);
              topModels.forEach(model => {
                const modelId = model.id || model.name || 'unknown';
                console.log(`     - ${modelId}`);
              });
            }
          } catch (e) {
            // Не JSON ответ, но это OK
            console.log(`   Ответ получен (${data.length} bytes)`);
          }
          
          resolve({ success: true, statusCode: res.statusCode });
        } else if (res.statusCode === 401) {
          console.log(`${colors.red}   ✗ Ошибка авторизации (401)${colors.reset}`);
          console.log(`${colors.yellow}   ℹ️  Проверьте правильность API ключа${colors.reset}`);
          resolve({ success: false, reason: 'auth_error', statusCode: res.statusCode });
        } else if (res.statusCode === 403) {
          console.log(`${colors.red}   ✗ Доступ запрещен (403)${colors.reset}`);
          console.log(`${colors.yellow}   ℹ️  Возможно нужен VPN для доступа из РФ${colors.reset}`);
          resolve({ success: false, reason: 'forbidden', statusCode: res.statusCode });
        } else {
          console.log(`${colors.red}   ✗ Ошибка HTTP ${res.statusCode}${colors.reset}`);
          resolve({ success: false, reason: 'http_error', statusCode: res.statusCode });
        }
      });
    });
    
    req.on('error', (error) => {
      console.log(`${colors.red}   ✗ Ошибка подключения${colors.reset}`);
      console.log(`   ${error.message}`);
      
      if (error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT')) {
        console.log(`${colors.yellow}   ℹ️  Возможно нужен VPN для доступа из РФ${colors.reset}`);
      }
      
      resolve({ success: false, reason: 'network_error', error: error.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.log(`${colors.red}   ✗ Превышено время ожидания (timeout)${colors.reset}`);
      resolve({ success: false, reason: 'timeout' });
    });
    
    req.end();
  });
}

/**
 * Главная функция
 */
async function main() {
  console.log(`\n${colors.cyan}Начинаем тестирование...${colors.reset}\n`);
  
  const results = [];
  
  for (const agg of aggregators) {
    const result = await testAggregator(agg);
    results.push({ name: agg.name, ...result });
  }
  
  // Итоговый отчет
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}📊 ИТОГОВЫЙ ОТЧЕТ${colors.reset}\n`);
  
  const successful = results.filter(r => r.success);
  const noKey = results.filter(r => r.reason === 'no_key');
  const failed = results.filter(r => !r.success && r.reason !== 'no_key');
  
  console.log(`${colors.green}✓ Успешно:              ${successful.length}${colors.reset}`);
  console.log(`${colors.yellow}⚠ Не настроен API ключ: ${noKey.length}${colors.reset}`);
  console.log(`${colors.red}✗ Ошибка подключения:   ${failed.length}${colors.reset}`);
  
  if (successful.length > 0) {
    console.log(`\n${colors.green}Рабочие агрегаторы:${colors.reset}`);
    successful.forEach(r => {
      console.log(`  ✓ ${r.name}`);
    });
  }
  
  if (noKey.length > 0) {
    console.log(`\n${colors.yellow}Требуется настройка:${colors.reset}`);
    noKey.forEach(r => {
      const agg = aggregators.find(a => a.name === r.name);
      console.log(`  ⚠ ${r.name} - Получите API ключ: ${agg.docs}`);
    });
  }
  
  if (failed.length > 0) {
    console.log(`\n${colors.red}Проблемы с подключением:${colors.reset}`);
    failed.forEach(r => {
      console.log(`  ✗ ${r.name} - ${r.reason || 'unknown error'}`);
    });
  }
  
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  
  // Рекомендации
  console.log(`\n${colors.cyan}📌 РЕКОМЕНДАЦИИ:${colors.reset}\n`);
  
  if (successful.length === 0) {
    console.log(`${colors.yellow}1. Настройте API ключи в файле .env${colors.reset}`);
    console.log(`   Откройте файл: notepad .env`);
    console.log(`   Получите ключи на сайтах агрегаторов\n`);
  }
  
  if (failed.some(r => r.reason === 'forbidden' || r.reason === 'network_error')) {
    console.log(`${colors.yellow}2. Для агрегаторов AI/ML API и OpenRouter может потребоваться VPN${colors.reset}`);
    console.log(`   GoGPT.ru и GPTunnel.ru работают из РФ без VPN ⭐\n`);
  }
  
  if (successful.length > 0) {
    console.log(`${colors.green}3. Готово к работе! Запустите N8N:${colors.reset}`);
    console.log(`   npm start         # Запуск через Docker (требует установки Docker)`);
    console.log(`   npx n8n           # Запуск напрямую (без Docker)\n`);
    console.log(`   Откройте: http://localhost:5678\n`);
  }
  
  console.log(`${colors.cyan}📚 Документация:${colors.reset}`);
  console.log(`   Агрегаторы: docs/RUSSIAN-AI-AGGREGATORS.md`);
  console.log(`   Установка Docker: docs/DOCKER-SETUP.md`);
  console.log(`   Быстрый старт: QUICKSTART.md`);
  
  console.log(`\n${colors.cyan}Тестирование завершено!${colors.reset}\n`);
}

// Запуск
main().catch(console.error);
