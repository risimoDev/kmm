#!/usr/bin/env node

/**
 * Скрипт инициализации Контент Завода
 * Проверяет окружение и настраивает систему
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chalk = require('chalk');
const ora = require('ora');

console.log(chalk.bold.cyan('\n🏭 КОНТЕНТ ЗАВОД - Инициализация\n'));

// Проверка Docker
const checkDocker = () => {
  const spinner = ora('Проверка Docker...').start();
  
  try {
    execSync('docker --version', { stdio: 'pipe' });
    execSync('docker-compose --version', { stdio: 'pipe' });
    spinner.succeed('Docker установлен ✅');
    return true;
  } catch (error) {
    spinner.fail('Docker не найден ❌');
    console.log(chalk.yellow('\nУстановите Docker:'));
    console.log(chalk.white('Windows: https://www.docker.com/products/docker-desktop'));
    console.log(chalk.white('Linux: curl -fsSL https://get.docker.com | sh\n'));
    return false;
  }
};

// Проверка .env файла
const checkEnvFile = () => {
  const spinner = ora('Проверка конфигурации...').start();
  
  const envPath = path.join(__dirname, '..', '.env');
  const envExamplePath = path.join(__dirname, '..', '.env.example');
  
  if (!fs.existsSync(envPath)) {
    spinner.info('.env файл не найден, создаю из .env.example');
    
    try {
      fs.copyFileSync(envExamplePath, envPath);
      spinner.succeed('.env файл создан ✅');
      console.log(chalk.yellow('\n⚠️  ВАЖНО: Отредактируйте .env файл и добавьте ваши API ключи!\n'));
      return false;
    } catch (error) {
      spinner.fail('Не удалось создать .env файл ❌');
      return false;
    }
  }
  
  spinner.succeed('.env файл найден ✅');
  return true;
};

// Проверка обязательных переменных
const checkRequiredEnv = () => {
  const spinner = ora('Проверка обязательных переменных...').start();
  
  require('dotenv').config();
  
  const required = [
    'N8N_ENCRYPTION_KEY',
    'DB_POSTGRESDB_PASSWORD',
    'REDIS_PASSWORD',
    'JWT_SECRET'
  ];
  
  const missing = [];
  
  required.forEach(key => {
    if (!process.env[key] || process.env[key].includes('change') || process.env[key].includes('your_')) {
      missing.push(key);
    }
  });
  
  if (missing.length > 0) {
    spinner.fail('Не хватает обязательных переменных ❌');
    console.log(chalk.yellow('\nНе настроены переменные:'));
    missing.forEach(key => console.log(chalk.white(`  - ${key}`)));
    console.log(chalk.yellow('\nОтредактируйте .env файл перед запуском!\n'));
    return false;
  }
  
  spinner.succeed('Все обязательные переменные настроены ✅');
  return true;
};

// Проверка API ключей
const checkApiKeys = () => {
  const spinner = ora('Проверка API ключей...').start();
  
  require('dotenv').config();
  
  const apis = {
    'AI (GPTunnel)': process.env.AI_API_KEY,
    'Telegram Bot': process.env.TELEGRAM_BOT_TOKEN,
    'HeyGen': process.env.HEYGEN_API_KEY
  };
  
  const configured = [];
  const missing = [];
  
  Object.entries(apis).forEach(([name, key]) => {
    if (key && !key.includes('your_')) {
      configured.push(name);
    } else {
      missing.push(name);
    }
  });
  
  if (configured.length === 0) {
    spinner.warn('API ключи не настроены ⚠️');
    console.log(chalk.yellow('\nДля полной функциональности добавьте API ключи в .env\n'));
    return false;
  }
  
  spinner.succeed(`Настроено API: ${configured.join(', ')} ✅`);
  
  if (missing.length > 0) {
    console.log(chalk.gray(`Не настроено: ${missing.join(', ')}`));
  }
  
  return true;
};

// Создание необходимых директорий
const createDirectories = () => {
  const spinner = ora('Создание директорий...').start();
  
  const dirs = [
    'workflows',
    'workflows/templates',
    'output',
    'output/videos',
    'output/images',
    'output/audio',
    'logs',
    'backups'
  ];
  
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
  
  spinner.succeed('Директории созданы ✅');
};

// Генерация encryption key если нужно
const generateEncryptionKey = () => {
  require('dotenv').config();
  
  if (process.env.N8N_ENCRYPTION_KEY && 
      !process.env.N8N_ENCRYPTION_KEY.includes('your_encryption')) {
    return;
  }
  
  const spinner = ora('Генерация encryption key...').start();
  
  try {
    const crypto = require('crypto');
    const key = crypto.randomBytes(32).toString('hex');
    
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent = envContent.replace(
      /N8N_ENCRYPTION_KEY=.*/,
      `N8N_ENCRYPTION_KEY=${key}`
    );
    
    fs.writeFileSync(envPath, envContent);
    
    spinner.succeed('Encryption key сгенерирован ✅');
  } catch (error) {
    spinner.fail('Не удалось сгенерировать ключ ❌');
    console.log(chalk.yellow('Сгенерируйте вручную: openssl rand -hex 32\n'));
  }
};

// Главная функция
const main = async () => {
  console.log(chalk.gray('Проверка системных требований...\n'));
  
  const dockerOk = checkDocker();
  if (!dockerOk) {
    process.exit(1);
  }
  
  const envExists = checkEnvFile();
  
  createDirectories();
  
  generateEncryptionKey();
  
  const envOk = checkRequiredEnv();
  const apiOk = checkApiKeys();
  
  console.log('\n' + chalk.bold.green('━'.repeat(50)));
  
  if (!envOk) {
    console.log(chalk.yellow('\n⚠️  Настройте .env файл перед запуском:\n'));
    console.log(chalk.white('1. Откройте .env файл в редакторе'));
    console.log(chalk.white('2. Замените значения your_* на реальные'));
    console.log(chalk.white('3. Запустите: npm start\n'));
    process.exit(0);
  }
  
  console.log(chalk.bold.green('\n✅ Система готова к запуску!\n'));
  console.log(chalk.white('Запуск системы:'));
  console.log(chalk.cyan('  npm start\n'));
  console.log(chalk.white('Или напрямую через Docker:'));
  console.log(chalk.cyan('  docker-compose up -d\n'));
  console.log(chalk.white('После запуска откройте:'));
  console.log(chalk.cyan('  http://localhost:5678\n'));
  console.log(chalk.gray('Логин/пароль указаны в .env файле\n'));
};

// Запуск
main().catch(error => {
  console.error(chalk.red('\n❌ Ошибка инициализации:'), error.message);
  process.exit(1);
});
