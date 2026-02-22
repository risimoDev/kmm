#!/usr/bin/env node

/**
 * Скрипт создания бэкапа
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DATE = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const TIME = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
const BACKUP_NAME = `backup_${DATE}_${TIME}`;

console.log(chalk.bold.cyan('\n💾 Создание бэкапа...\n'));

// Создать директорию для бэкапов
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const backupPath = path.join(BACKUP_DIR, BACKUP_NAME);
fs.mkdirSync(backupPath, { recursive: true });

try {
  // 1. Бэкап PostgreSQL
  console.log(chalk.blue('📊 Экспорт базы данных...'));
  execSync(
    `docker exec content-factory-postgres pg_dump -U n8n_user n8n > ${path.join(backupPath, 'database.sql')}`,
    { stdio: 'inherit' }
  );
  console.log(chalk.green('✓ База данных сохранена\n'));

  // 2. Бэкап N8N данных
  console.log(chalk.blue('🔄 Копирование N8N данных...'));
  execSync(
    `docker cp content-factory-n8n:/home/node/.n8n ${backupPath}/n8n_data`,
    { stdio: 'inherit' }
  );
  console.log(chalk.green('✓ N8N данные скопированы\n'));

  // 3. Бэкап .env файла
  console.log(chalk.blue('⚙️  Копирование конфигурации...'));
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, path.join(backupPath, 'env.backup'));
    console.log(chalk.green('✓ Конфигурация сохранена\n'));
  }

  // 4. Создать архив
  console.log(chalk.blue('📦 Создание архива...'));
  execSync(
    `tar -czf ${backupPath}.tar.gz -C ${BACKUP_DIR} ${BACKUP_NAME}`,
    { stdio: 'inherit' }
  );
  
  // Удалить временную директорию
  execSync(`rm -rf ${backupPath}`, { stdio: 'inherit' });
  
  const stats = fs.statSync(`${backupPath}.tar.gz`);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(chalk.green(`✓ Архив создан: ${BACKUP_NAME}.tar.gz (${sizeMB} MB)\n`));

  // 5. Очистка старых бэкапов (>30 дней)
  console.log(chalk.blue('🧹 Очистка старых бэкапов...'));
  const files = fs.readdirSync(BACKUP_DIR);
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  let deletedCount = 0;
  files.forEach(file => {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    
    if (stats.mtime.getTime() < thirtyDaysAgo) {
      fs.unlinkSync(filePath);
      deletedCount++;
    }
  });
  
  if (deletedCount > 0) {
    console.log(chalk.green(`✓ Удалено старых бэкапов: ${deletedCount}\n`));
  } else {
    console.log(chalk.gray('Нет старых бэкапов для удаления\n'));
  }

  console.log(chalk.bold.green('✅ Бэкап успешно создан!\n'));
  console.log(chalk.white(`Расположение: ${backupPath}.tar.gz\n`));

} catch (error) {
  console.error(chalk.red('\n❌ Ошибка создания бэкапа:'), error.message);
  process.exit(1);
}
