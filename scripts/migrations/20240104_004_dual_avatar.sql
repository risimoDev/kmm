-- Migration 004: Add montage_script column + fal_api_key setting for dual avatar (Product + HeyGen Avatar) support
-- Run: psql $DATABASE_URL -f 20240104_004_dual_avatar.sql

ALTER TABLE voice_scripts ADD COLUMN IF NOT EXISTS montage_script JSONB DEFAULT '[]';

COMMENT ON COLUMN voice_scripts.montage_script IS
  'JSON array of montage segments for dual_avatar type: [{order, source (product|heygen), duration, purpose}]';

-- Add FAL.ai API key setting for product video generation
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES ('fal_api_key', '', 'string', 'video', 'FAL.ai API Key', 'API ключ FAL.ai для генерации продуктового видео (image-to-video)', TRUE)
ON CONFLICT (key) DO NOTHING;
