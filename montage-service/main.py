# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# РљРѕРЅС‚РµРЅС‚ Р—Р°РІРѕРґ вЂ” Montage Service v2.0
# FastAPI + FFmpeg вЂ” РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅС‹Р№ СЃРµСЂРІРёСЃ СЂРµРЅРґРµСЂР°
# в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
# Р’РѕР·РјРѕР¶РЅРѕСЃС‚Рё v2:
#  вЂў LUT-РїСЂРµСЃРµС‚С‹ (cinematic, warm, cold, teal_orange, b&w вЂ¦)
#  вЂў Chroma key (СѓРґР°Р»РµРЅРёРµ С„РѕРЅР° РїРѕ С†РІРµС‚Сѓ)
#  вЂў Р’РёРґРµРѕСЃС‚Р°Р±РёР»РёР·Р°С†РёСЏ (2-pass vidstab)
#  вЂў Keyframe-Р°РЅРёРјР°С†РёРё (zoompan СЃ Р»РёРЅРµР№РЅРѕР№ РёРЅС‚РµСЂРїРѕР»СЏС†РёРµР№)
#  вЂў Р РµРЅРґРµСЂ С‚РµРєСЃС‚РѕРІС‹С… РєР»РёРїРѕРІ С‡РµСЂРµР· FFmpeg drawtext
#  вЂў РЎР¶РёРіР°РЅРёРµ СЃСѓР±С‚РёС‚СЂРѕРІ РёР· .srt/.ass С„Р°Р№Р»РѕРІ
#  вЂў РђРЅР°Р»РёР· BPM Р°СѓРґРёРѕС„Р°Р№Р»РѕРІ (librosa)
#  вЂў Р”РµС‚РµРєС†РёСЏ СЃС†РµРЅ РІ РІРёРґРµРѕ (PySceneDetect)
#  вЂў РР·РІР»РµС‡РµРЅРёРµ РєР°РґСЂР° РїРѕ РІСЂРµРјРµРЅРЅРѕР№ РјРµС‚РєРµ
#  вЂў РњСѓР»СЊС‚РёС„РѕСЂРјР°С‚РЅС‹Р№ СЂРµРЅРґРµСЂ
#  вЂў WebSocket Рё REST РїСЂРѕРіСЂРµСЃСЃ СЂРµРЅРґРµСЂР°
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

from __future__ import annotations

import os
import uuid
import asyncio
import logging
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import boto3
from botocore.client import Config as BotoConfig
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# в”Ђв”Ђв”Ђ Р›РѕРіРёСЂРѕРІР°РЅРёРµ в”Ђв”Ђв”Ђ
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('montage')

# в”Ђв”Ђв”Ђ РљРѕРЅС„РёРіСѓСЂР°С†РёСЏ в”Ђв”Ђв”Ђ
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'minio')
MINIO_PORT = int(os.getenv('MINIO_PORT', '9000'))
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY', os.getenv('MINIO_ROOT_USER', 'minioadmin'))
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY', os.getenv('MINIO_ROOT_PASSWORD', 'minioadmin'))
MINIO_BUCKET = os.getenv('MINIO_BUCKET', 'content-factory')
RENDER_DIR = Path('/tmp/renders')
RENDER_DIR.mkdir(parents=True, exist_ok=True)

FONT_BOLD    = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_FILE    = FONT_BOLD if Path(FONT_BOLD).exists() else (FONT_REGULAR if Path(FONT_REGULAR).exists() else '')

# в”Ђв”Ђв”Ђ S3 РєР»РёРµРЅС‚ (MinIO) в”Ђв”Ђв”Ђ
s3 = boto3.client(
    's3',
    endpoint_url=f'http://{MINIO_ENDPOINT}:{MINIO_PORT}',
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    config=BotoConfig(signature_version='s3v4'),
    region_name='us-east-1',
)

# в”Ђв”Ђв”Ђ FastAPI в”Ђв”Ђв”Ђ
app = FastAPI(title='Montage Service', version='2.0.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

# в”Ђв”Ђв”Ђ Р“Р»РѕР±Р°Р»СЊРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ в”Ђв”Ђв”Ђ
jobs:           dict[str, dict] = {}
job_queue:      asyncio.Queue   = asyncio.Queue()
ws_subscribers: dict[str, set]  = {}   # job_id в†’ {WebSocket}


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# PYDANTIC MODELS
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

class KeyFrame(BaseModel):
    """РљР»СЋС‡РµРІРѕР№ РєР°РґСЂ РґР»СЏ Р°РЅРёРјР°С†РёРё (Ken Burns, pan/zoom)"""
    time:    float = 0.0
    scale:   float = 1.0    # Р·СѓРј (1.0 = Р±РµР· Р·СѓРјР°)
    x:       float = 0.0    # СЃРјРµС‰РµРЅРёРµ X (-0.5 вЂ¦ 0.5 РѕС‚ С€РёСЂРёРЅС‹)
    y:       float = 0.0    # СЃРјРµС‰РµРЅРёРµ Y (-0.5 вЂ¦ 0.5 РѕС‚ РІС‹СЃРѕС‚С‹)
    opacity: float = 1.0

class ClipEffect(BaseModel):
    fade_in:           float = 0.0
    fade_out:          float = 0.0
    volume:            float = 1.0
    speed:             float = 1.0
    filters:           list[str] = []
    # v2.0 additions
    lut_preset:        Optional[str] = None   # cinematic|warm|cold|teal_orange|bw|vintage|vibrant|fade|bleach
    chroma_key_color:  Optional[str] = None   # hex С†РІРµС‚, РЅР°РїСЂ. '#00FF00'
    chroma_key_sim:    float = 0.15
    chroma_key_blend:  float = 0.05
    stabilize:         bool  = False

class TextStyle(BaseModel):
    font:       str   = 'DejaVu Sans'
    size:       int   = 48
    color:      str   = '#FFFFFF'
    bg_color:   str   = '#000000'
    bg_opacity: float = 0.6
    position:   str   = 'bottom'   # bottom|top|center|x%,y%
    animation:  str   = 'fade'

class Clip(BaseModel):
    id:           str
    source:       Optional[str]      = None
    text:         Optional[str]      = None
    start:        float              = 0.0
    duration:     float              = 5.0
    trim_start:   float              = 0.0
    trim_end:     Optional[float]    = None
    effects:      Optional[ClipEffect] = None
    style:        Optional[TextStyle]  = None
    # v2.0 additions
    keyframes:    list[KeyFrame]     = []
    subtitle_url: Optional[str]      = None   # URL Рє .srt/.ass С„Р°Р№Р»Сѓ

class Track(BaseModel):
    id:    str
    type:  str            # video | audio | text | image
    clips: list[Clip] = []

class OutputSettings(BaseModel):
    resolution: str   = '1080x1920'
    fps:        int   = 30
    format:     str   = 'mp4'
    duration:   float = 30.0

class MontageScript(BaseModel):
    output:  OutputSettings       = Field(default_factory=OutputSettings)
    tracks:  list[Track]          = []
    preview: bool                 = False

class AnalyzeRequest(BaseModel):
    source: str   # URL РёР»Рё minio:// РїСѓС‚СЊ

class MultiFormatRequest(BaseModel):
    script:      MontageScript
    resolutions: list[str]        = ['1080x1920', '1920x1080', '1080x1080']


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# LUT РџР Р•РЎР•РўР«  (С‡РµСЂРµР· РЅР°С‚РёРІРЅС‹Рµ FFmpeg С„РёР»СЊС‚СЂС‹)
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

LUT_PRESETS: dict[str, str] = {
    'cinematic':   (
        "curves=r='0/0 0.3/0.25 0.7/0.68 1/1'"
        ":g='0/0 0.3/0.28 0.7/0.67 1/1'"
        ":b='0/0 0.3/0.35 0.7/0.73 1/1'"
    ),
    'warm':        "colorbalance=rs=0.25:gs=0.05:bs=-0.20:rm=0.10:gm=0.00:bm=-0.10",
    'cold':        "colorbalance=rs=-0.20:gs=-0.05:bs=0.25:rm=-0.10:gm=0.00:bm=0.10",
    'bw':          "hue=s=0",
    'vintage':     "curves=r='0/0.08 1/0.92':g='0/0.05 1/0.88':b='0/0.12 1/0.80',eq=saturation=0.75",
    'vibrant':     "eq=saturation=1.55:contrast=1.06:brightness=0.02",
    'teal_orange': "colorbalance=rs=0.25:gs=-0.05:bs=-0.20:rm=0.08:gm=0.00:bm=-0.08:rh=0.15:gh=0.00:bh=-0.20",
    'fade':        "curves=r='0/0.10 1/0.90':g='0/0.10 1/0.90':b='0/0.10 1/0.90',eq=saturation=0.80",
    'bleach':      "curves=preset=color_negative,negate,curves=preset=color_negative,eq=saturation=0.6:contrast=1.2",
}

LUT_DESCRIPTIONS: dict[str, str] = {
    'cinematic':   'РљРёРЅРѕ (РїСЂРёС‚СѓС€РµРЅРЅС‹Рµ С‚РµРЅРё, С‚С‘РїР»С‹Рµ Р±Р»РёРєРё)',
    'warm':        'РўС‘РїР»С‹Р№ (Р·РѕР»РѕС‚РёСЃС‚С‹Р№ С‚РѕРЅ)',
    'cold':        'РҐРѕР»РѕРґРЅС‹Р№ (СЃРёРЅРµРІР°С‚С‹Р№ С‚РѕРЅ)',
    'bw':          'Р§С‘СЂРЅРѕ-Р±РµР»С‹Р№',
    'vintage':     'Р’РёРЅС‚Р°Р¶ (РІС‹РіРѕСЂРµРІС€РёРµ С‚РѕРЅР°)',
    'vibrant':     'РЇСЂРєРёР№ (РЅР°СЃС‹С‰РµРЅРЅРѕСЃС‚СЊ +55%)',
    'teal_orange': 'Teal & Orange (РєРёРЅРµРјР°С‚РѕРіСЂР°С„РёС‡РЅС‹Р№)',
    'fade':        'Р’С‹С†РІРµС‚С€РёР№ (РїСЂРёРіР»СѓС€РµРЅРЅС‹Р№)',
    'bleach':      'Bleach Bypass (РІС‹СЃРѕРєРѕРєРѕРЅС‚СЂР°СЃС‚РЅС‹Р№)',
}


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# Р’РЎРџРћРњРћР“РђРўР•Р›Р¬РќР«Р• Р¤РЈРќРљР¦РР
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

def download_source(source: str, job_dir: Path) -> str:
    """РЎРєР°С‡РёРІР°РµС‚ С„Р°Р№Р» РёР· MinIO РёР»Рё РїРѕ HTTP. Р’РѕР·РІСЂР°С‰Р°РµС‚ Р»РѕРєР°Р»СЊРЅС‹Р№ РїСѓС‚СЊ."""
    if not source:
        return source
    if source.startswith('minio://'):
        parts  = source.replace('minio://', '').split('/', 1)
        bucket = parts[0]
        key    = parts[1] if len(parts) > 1 else ''
        local  = job_dir / Path(key).name
        s3.download_file(bucket, key, str(local))
        logger.info(f'MinIO в†ђ {key[:60]}')
        return str(local)
    if source.startswith(('http://', 'https://')):
        name  = source.split('/')[-1].split('?')[0] or 'file.bin'
        local = job_dir / name
        subprocess.run(
            ['curl', '-sL', '--max-time', '120', '-o', str(local), source],
            check=True, timeout=130,
        )
        logger.info(f'HTTP  в†ђ {source[:80]}')
        return str(local)
    return source


def lerp_expr(kfs: list[KeyFrame], attr: str, fps: int) -> str:
    """РЎС‚СЂРѕРёС‚ РєСѓСЃРѕС‡РЅРѕ-Р»РёРЅРµР№РЅРѕРµ FFmpeg-РІС‹СЂР°Р¶РµРЅРёРµ РґР»СЏ Р°С‚СЂРёР±СѓС‚Р° keyframe."""
    if not kfs:
        return '1' if attr == 'scale' else '0'
    if len(kfs) == 1:
        return str(getattr(kfs[0], attr))
    kfs = sorted(kfs, key=lambda k: k.time)
    last_val = getattr(kfs[-1], attr)
    expr = str(last_val)
    for i in range(len(kfs) - 2, -1, -1):
        s, e   = kfs[i], kfs[i + 1]
        sf     = int(s.time * fps)
        ef     = max(int(e.time * fps), sf + 1)
        sv, ev = getattr(s, attr), getattr(e, attr)
        if sv == ev:
            interp = str(sv)
        else:
            interp = f'({sv})+(({ev})-({sv}))*(on-{sf})/({ef}-{sf})'
        expr = f'if(between(on,{sf},{ef}),{interp},{expr})'
    return expr


def parse_text_position(pos: str) -> tuple[str, str]:
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ FFmpeg x/y РІС‹СЂР°Р¶РµРЅРёСЏ РґР»СЏ drawtext."""
    presets = {
        'bottom':        ('(w-text_w)/2',       'h*0.83'),
        'bottom_left':   ('w*0.04',              'h*0.83'),
        'bottom_right':  ('w-text_w-w*0.04',     'h*0.83'),
        'top':           ('(w-text_w)/2',         'h*0.06'),
        'top_left':      ('w*0.04',              'h*0.06'),
        'top_right':     ('w-text_w-w*0.04',     'h*0.06'),
        'center':        ('(w-text_w)/2',         '(h-text_h)/2'),
        'center_top':    ('(w-text_w)/2',         'h*0.25'),
        'center_bottom': ('(w-text_w)/2',         'h*0.65'),
    }
    if pos in presets:
        return presets[pos]
    if ',' in pos:
        parts = pos.split(',')
        try:
            xp = float(parts[0].replace('%', '').strip()) / 100
            yp = float(parts[1].replace('%', '').strip()) / 100
            return (f'(w-text_w)/2+w*{xp - 0.5:.4f}', f'h*{yp:.4f}-text_h/2')
        except (ValueError, IndexError):
            pass
    return ('(w-text_w)/2', 'h*0.83')


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# РџР Р•Р”РћР‘Р РђР‘РћРўРљРђ: РЎРўРђР‘РР›РР—РђР¦РРЇ
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

async def pre_stabilize(input_path: str, job_dir: Path, idx: int) -> str:
    """2-pass РІРёРґРµРѕСЃС‚Р°Р±РёР»РёР·Р°С†РёСЏ (vidstab). Р’РѕР·РІСЂР°С‰Р°РµС‚ РїСѓС‚СЊ Рє РЅРѕРІРѕРјСѓ С„Р°Р№Р»Сѓ."""
    trf_file   = str(job_dir / f'stab_{idx}.trf')
    stable_out = str(job_dir / f'stable_{idx}.mp4')

    p1 = await asyncio.create_subprocess_exec(
        'ffmpeg', '-y', '-i', input_path,
        '-vf', f'vidstabdetect=smoothing=15:result={trf_file}',
        '-an', '-f', 'null', '-',
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await p1.wait()
    if not Path(trf_file).exists():
        logger.warning(f'vidstabdetect failed РґР»СЏ {input_path}')
        return input_path

    p2 = await asyncio.create_subprocess_exec(
        'ffmpeg', '-y', '-i', input_path,
        '-vf', (
            f'vidstabtransform=input={trf_file}:smoothing=15:crop=black,'
            'unsharp=5:5:0.8:3:3:0.4'
        ),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-an', stable_out,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await p2.wait()
    if Path(stable_out).exists():
        logger.info(f'Stabilized в†’ {stable_out}')
        return stable_out
    return input_path


async def pre_process(script: MontageScript, job_dir: Path) -> None:
    """РџСЂРµРґРѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ РєР»РёРїС‹ (СЃС‚Р°Р±РёР»РёР·Р°С†РёСЏ). РњСѓС‚РёСЂСѓРµС‚ source in-place."""
    idx = 0
    loop = asyncio.get_event_loop()
    for track in script.tracks:
        if track.type != 'video':
            continue
        for clip in track.clips:
            if clip.source and clip.effects and clip.effects.stabilize:
                local = await loop.run_in_executor(
                    None, download_source, clip.source, job_dir
                )
                clip.source = await pre_stabilize(local, job_dir, idx)
                idx += 1


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# РџРћРЎРўР РћРРўР•Р›Р¬ FFmpeg РљРћРњРђРќР”Р«
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

def build_ffmpeg_command(
    script: MontageScript,
    job_dir: Path,
    output_path: str,
) -> tuple[list[str], list[str]]:
    """
    РЎС‚СЂРѕРёС‚ РєРѕРјР°РЅРґСѓ FFmpeg РёР· СЃРєСЂРёРїС‚Р° РјРѕРЅС‚Р°Р¶Р°.
    Р’РѕР·РІСЂР°С‰Р°РµС‚ (cmd, srt_paths) РіРґРµ srt_paths вЂ” СЃРїРёСЃРѕРє .srt С„Р°Р№Р»РѕРІ
    РґР»СЏ РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕРіРѕ РїСЂРѕС…РѕРґР° СЃСѓР±С‚РёС‚СЂРёСЂРѕРІР°РЅРёСЏ.
    """
    w, h      = (int(v) for v in script.output.resolution.split('x'))
    fps       = script.output.fps
    total_dur = script.output.duration

    if script.preview:
        w = min(w, 720)
        h = min(h, 1280)

    inputs:        list[str]   = []
    filter_parts:  list[str]   = []
    video_streams: list[tuple] = []   # (label, start, dur)
    audio_streams: list[tuple] = []   # (label, start_ms)
    text_clips:    list[Clip]  = []
    srt_paths:     list[str]   = []
    input_idx      = 0

    for track in script.tracks:

        # в”Ђв”Ђ Р’РР”Р•Рћ / РљРђР РўРРќРљР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
        if track.type in ('video', 'image'):
            for clip in track.clips:
                if not clip.source:
                    continue
                local = download_source(clip.source, job_dir)
                inputs.extend(['-i', local])

                trim_end = clip.trim_end if clip.trim_end is not None else (clip.trim_start + clip.duration)
                flt: list[str] = [
                    f'trim=start={clip.trim_start}:end={trim_end}',
                    'setpts=PTS-STARTPTS',
                ]

                if clip.effects and clip.effects.speed != 1.0:
                    flt.append(f'setpts={1.0 / clip.effects.speed}*PTS')

                # Chroma key вЂ” РґРѕ РјР°СЃС€С‚Р°Р±РёСЂРѕРІР°РЅРёСЏ
                if clip.effects and clip.effects.chroma_key_color:
                    hex_c = clip.effects.chroma_key_color.lstrip('#')
                    flt.append(
                        f'chromakey=color=0x{hex_c}'
                        f':similarity={clip.effects.chroma_key_sim:.3f}'
                        f':blend={clip.effects.chroma_key_blend:.3f}'
                    )

                # РњР°СЃС€С‚Р°Р±РёСЂРѕРІР°РЅРёРµ СЃ letterbox
                flt.extend([
                    f'scale={w}:{h}:force_original_aspect_ratio=decrease',
                    f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black',
                ])

                # LUT-РїСЂРµСЃРµС‚ вЂ” РїРѕСЃР»Рµ РјР°СЃС€С‚Р°Р±РёСЂРѕРІР°РЅРёСЏ
                if clip.effects and clip.effects.lut_preset:
                    lut_filter = LUT_PRESETS.get(clip.effects.lut_preset, '')
                    if lut_filter:
                        flt.append(lut_filter)

                # РЎР°РЅРёС‚РёР·РёСЂРѕРІР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ С„РёР»СЊС‚СЂС‹
                for uf in (clip.effects.filters if clip.effects else []):
                    safe = ''.join(c for c in uf if c.isalnum() or c in '=.,:-_/()@ ').strip()
                    if safe:
                        flt.append(safe)

                # Keyframe zoompan (Ken Burns)
                if clip.keyframes:
                    total_frames = max(int(clip.duration * fps), 1)
                    z_expr = lerp_expr(clip.keyframes, 'scale', fps)
                    x_off  = lerp_expr(clip.keyframes, 'x', fps)
                    y_off  = lerp_expr(clip.keyframes, 'y', fps)
                    x_expr = f'(iw-iw/({z_expr}))/2+({x_off})*iw'
                    y_expr = f'(ih-ih/({z_expr}))/2+({y_off})*ih'
                    flt.append(
                        f'zoompan=z=\'{z_expr}\':x=\'{x_expr}\':y=\'{y_expr}\''
                        f':d={total_frames}:fps={fps}:s={w}x{h}'
                    )

                if clip.effects and clip.effects.fade_in > 0:
                    flt.append(f'fade=t=in:st=0:d={clip.effects.fade_in}')
                if clip.effects and clip.effects.fade_out > 0:
                    st = max(clip.duration - clip.effects.fade_out, 0)
                    flt.append(f'fade=t=out:st={st}:d={clip.effects.fade_out}')

                if clip.subtitle_url:
                    srt_paths.append(download_source(clip.subtitle_url, job_dir))

                stream_label = f'v{input_idx}'
                filter_parts.append(f'[{input_idx}:v]{",".join(flt)}[{stream_label}]')
                video_streams.append((stream_label, clip.start, clip.duration))
                input_idx += 1

        # в”Ђв”Ђ РўР•РљРЎРў в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
        elif track.type == 'text':
            text_clips.extend(track.clips)

        # в”Ђв”Ђ РђРЈР”РРћ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
        elif track.type == 'audio':
            for clip in track.clips:
                if not clip.source:
                    continue
                local = download_source(clip.source, job_dir)
                inputs.extend(['-i', local])

                trim_end = clip.trim_end if clip.trim_end is not None else (clip.trim_start + clip.duration)
                flt_a: list[str] = [
                    f'atrim=start={clip.trim_start}:end={trim_end}',
                    'asetpts=PTS-STARTPTS',
                ]
                if clip.effects and clip.effects.speed != 1.0:
                    flt_a.append(f'atempo={min(max(clip.effects.speed, 0.5), 2.0):.3f}')
                if clip.effects and clip.effects.volume != 1.0:
                    flt_a.append(f'volume={clip.effects.volume:.3f}')
                if clip.effects and clip.effects.fade_in > 0:
                    flt_a.append(f'afade=t=in:st=0:d={clip.effects.fade_in}')
                if clip.effects and clip.effects.fade_out > 0:
                    st = max(clip.duration - clip.effects.fade_out, 0)
                    flt_a.append(f'afade=t=out:st={st}:d={clip.effects.fade_out}')

                stream_label = f'a{input_idx}'
                filter_parts.append(f'[{input_idx}:a]{",".join(flt_a)}[{stream_label}]')
                audio_streams.append((stream_label, int(clip.start * 1000)))
                input_idx += 1

    # в”Ђв”Ђ FALLBACK: РЅРµС‚ РјРµРґРёР° в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    if not inputs:
        return [
            'ffmpeg', '-y',
            '-f', 'lavfi', '-i', f'color=c=black:s={w}x{h}:d={total_dur}:r={fps}',
            '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
            '-t', str(total_dur),
            '-c:v', 'libx264', '-preset', 'ultrafast' if script.preview else 'medium',
            '-crf', '28' if script.preview else '23',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
            output_path,
        ], srt_paths

    # в”Ђв”Ђ Р’РР”Р•Рћ-РљРћРњРџРћР—РРў в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    filter_parts.append(f'color=c=black:s={w}x{h}:d={total_dur}:r={fps}[base]')
    current = 'base'
    for i, (label, start, dur) in enumerate(video_streams):
        out_lbl = f'ov{i}'
        filter_parts.append(
            f'[{current}][{label}]overlay=0:0'
            f":enable='between(t,{start},{start + dur})'[{out_lbl}]"
        )
        current = out_lbl
    filter_parts.append(f'[{current}]fps={fps}[composite]')
    current = 'composite'

    # в”Ђв”Ђ DRAWTEXT в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    for ti, tc in enumerate(text_clips):
        if not tc.text:
            continue
        style   = tc.style or TextStyle()
        x_expr, y_expr = parse_text_position(style.position)
        fc_hex  = style.color.lstrip('#')
        # РўРµРєСЃС‚ РІ С„Р°Р№Р» вЂ” РёР·Р±РµРіР°РµС‚ РїСЂРѕР±Р»РµРј СЃ СЌРєСЂР°РЅРёСЂРѕРІР°РЅРёРµРј СЃРїРµС†СЃРёРјРІРѕР»РѕРІ
        txt_file = job_dir / f'text_{ti}.txt'
        txt_file.write_text(tc.text, encoding='utf-8')
        font_opt = f":fontfile='{FONT_FILE}'" if FONT_FILE else ''
        dt = (
            f"drawtext=textfile='{txt_file}'"
            f"{font_opt}"
            f":fontsize={style.size}"
            f":fontcolor=#{fc_hex}"
            f":box=1"
            f":boxcolor=#{style.bg_color.lstrip('#')}@{style.bg_opacity:.2f}"
            f":boxborderw=10"
            f":x={x_expr}:y={y_expr}"
            f":line_spacing=4"
            f":enable='between(t,{tc.start},{tc.start + tc.duration})'"
        )
        out_lbl = f'dt{ti}'
        filter_parts.append(f'[{current}]{dt}[{out_lbl}]')
        current = out_lbl

    filter_parts.append(f'[{current}]copy[vout]')

    # в”Ђв”Ђ РђРЈР”РРћ РњРРљРЁР•Р  в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    if audio_streams:
        for label, delay_ms in audio_streams:
            filter_parts.append(f'[{label}]adelay={delay_ms}|{delay_ms}[{label}d]')
        mix_in = ''.join(f'[{l}d]' for l, _ in audio_streams)
        filter_parts.append(f'{mix_in}amix=inputs={len(audio_streams)}:normalize=0[aout]')
        map_args = ['-map', '[vout]', '-map', '[aout]']
    else:
        filter_parts.append('anullsrc=r=44100:cl=stereo[aout]')
        map_args = ['-map', '[vout]', '-map', '[aout]']

    filter_complex = ';\n'.join(filter_parts)

    cmd = [
        'ffmpeg', '-y',
        *inputs,
        '-filter_complex', filter_complex,
        *map_args,
        '-t', str(total_dur),
        '-c:v', 'libx264',
        '-preset', 'ultrafast' if script.preview else 'medium',
        '-crf',    '28'        if script.preview else '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output_path,
    ]
    return cmd, srt_paths


async def burn_subtitles(video_path: str, srt_paths: list[str], job_dir: Path) -> str:
    """РќР°РєР»Р°РґС‹РІР°РµС‚ .srt СЃСѓР±С‚РёС‚СЂС‹ (РїРѕСЃС‚-РїСЂРѕС…РѕРґ). Р’РѕР·РІСЂР°С‰Р°РµС‚ РїСѓС‚СЊ Рє РЅРѕРІРѕРјСѓ С„Р°Р№Р»Сѓ."""
    current = video_path
    for idx, srt in enumerate(srt_paths):
        out = str(job_dir / f'subs_{idx}.mp4')
        safe_srt = srt.replace(':', '\\:').replace("'", "\\'")
        p = await asyncio.create_subprocess_exec(
            'ffmpeg', '-y', '-i', current,
            '-vf', (
                f"subtitles='{safe_srt}'"
                ":force_style='FontName=DejaVu Sans"
                ",FontSize=24,PrimaryColour=&H00FFFFFF"
                ",OutlineColour=&H00000000,BorderStyle=1,Outline=2'"
            ),
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'copy', out,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await p.communicate()
        if p.returncode == 0 and Path(out).exists():
            current = out
        else:
            logger.warning(f'Subtitle burn failed: {stderr[-200:].decode()}')
    return current


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# WebSocket СѓРІРµРґРѕРјР»РµРЅРёСЏ
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

async def notify_ws(job_id: str, data: dict) -> None:
    subs = ws_subscribers.get(job_id, set()).copy()
    dead: set = set()
    for ws in subs:
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    ws_subscribers.get(job_id, set()).difference_update(dead)


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# Р Р•РќР”Р•Р  вЂ” РѕСЃРЅРѕРІРЅР°СЏ Р»РѕРіРёРєР°
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

async def render_job(job_id: str, script: MontageScript) -> None:
    job = jobs[job_id]
    job.update({'status': 'processing', 'progress': 0})
    logger.info(f'[{job_id[:8]}] Р РµРЅРґРµСЂ РЅР°С‡Р°С‚')

    job_dir     = RENDER_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    ext         = script.output.format or 'mp4'
    output_path = str(job_dir / f'output.{ext}')

    try:
        await notify_ws(job_id, {'status': 'processing', 'progress': 0})

        # РџСЂРµРґРѕР±СЂР°Р±РѕС‚РєР° (СЃС‚Р°Р±РёР»РёР·Р°С†РёСЏ)
        await pre_process(script, job_dir)

        loop = asyncio.get_event_loop()
        cmd, srt_paths = await loop.run_in_executor(
            None, build_ffmpeg_command, script, job_dir, output_path
        )
        logger.info(f'[{job_id[:8]}] cmd: {" ".join(cmd[:8])}вЂ¦')

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        stderr_buf = b''
        async for line in process.stderr:
            stderr_buf += line
            decoded = line.decode('utf-8', errors='ignore').strip()
            if 'time=' in decoded:
                try:
                    time_str = decoded.split('time=')[1].split(' ')[0]
                    parts    = time_str.split(':')
                    cur      = float(parts[0])*3600 + float(parts[1])*60 + float(parts[2])
                    progress = min(int(cur / script.output.duration * 95), 95)
                    job['progress'] = progress
                    fps_val = 0.0
                    if 'fps=' in decoded:
                        try:
                            fps_val = float(decoded.split('fps=')[1].split(' ')[0])
                        except (ValueError, IndexError):
                            pass
                    eta = (
                        int((script.output.duration - cur) * script.output.fps / fps_val)
                        if fps_val > 0 else 0
                    )
                    await notify_ws(job_id, {
                        'status': 'processing', 'progress': progress,
                        'time': round(cur, 1), 'fps': round(fps_val, 1), 'eta': eta,
                    })
                except (ValueError, IndexError):
                    pass

        await process.wait()
        if process.returncode != 0:
            raise RuntimeError(
                f'FFmpeg exit {process.returncode}: '
                + stderr_buf.decode('utf-8', errors='ignore')[-600:]
            )

        # РџРѕСЃС‚-РїСЂРѕС…РѕРґ: СЃСѓР±С‚РёС‚СЂС‹
        if srt_paths:
            output_path = await burn_subtitles(output_path, srt_paths, job_dir)

        # Р—Р°РіСЂСѓР·РєР° РІ MinIO
        output_key = f'renders/{job_id}/output.{ext}'
        await loop.run_in_executor(None, s3.upload_file, output_path, MINIO_BUCKET, output_key)

        # РџСЂРµРІСЊСЋ (РїРµСЂРІС‹Р№ РєР°РґСЂ)
        preview = str(job_dir / 'preview.png')
        pp = await asyncio.create_subprocess_exec(
            'ffmpeg', '-y', '-i', output_path,
            '-vf', 'select=eq(n\\,0),scale=360:-2', '-frames:v', '1', preview,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await pp.wait()

        output_url = f'minio://{MINIO_BUCKET}/{output_key}'
        job.update({
            'status': 'done', 'progress': 100,
            'output_url': output_url, 'output_path': output_path,
            'completed_at': datetime.now().isoformat(),
        })
        logger.info(f'[{job_id[:8]}] Р“РѕС‚РѕРІРѕ в†’ {output_key}')
        await notify_ws(job_id, {'status': 'done', 'progress': 100, 'output_url': output_url})

    except Exception as e:
        logger.error(f'[{job_id[:8]}] РћС€РёР±РєР°: {e}')
        job.update({
            'status': 'error', 'error_text': str(e),
            'completed_at': datetime.now().isoformat(),
        })
        await notify_ws(job_id, {'status': 'error', 'error': str(e)})


async def worker() -> None:
    logger.info('Р’РѕСЂРєРµСЂ СЂРµРЅРґРµСЂР° Р·Р°РїСѓС‰РµРЅ')
    while True:
        job_id, script = await job_queue.get()
        try:
            await render_job(job_id, script)
        except Exception as e:
            logger.error(f'РљСЂРёС‚РёС‡РЅР°СЏ РѕС€РёР±РєР° РІРѕСЂРєРµСЂР°: {e}')
        finally:
            job_queue.task_done()


@app.on_event('startup')
async def startup() -> None:
    asyncio.create_task(worker())
    logger.info('Montage Service v2.0 Р·Р°РїСѓС‰РµРЅ РЅР° РїРѕСЂС‚Сѓ 8001')


# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
# ENDPOINTS
# в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

@app.post('/render')
async def start_render(script: MontageScript):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        'id': job_id, 'status': 'queued', 'progress': 0,
        'output_url': None, 'output_path': None, 'error_text': None,
        'created_at': datetime.now().isoformat(), 'completed_at': None,
        'script': script.dict(),
    }
    await job_queue.put((job_id, script))
    return {'ok': True, 'job_id': job_id}


@app.post('/render/multi')
async def start_render_multi(req: MultiFormatRequest):
    """Р РµРЅРґРµСЂ РІ РЅРµСЃРєРѕР»СЊРєРёС… СЂР°Р·СЂРµС€РµРЅРёСЏС… РїР°СЂР°Р»Р»РµР»СЊРЅРѕ."""
    result = []
    for resolution in req.resolutions:
        copy       = req.script.copy(deep=True)
        copy.output.resolution = resolution
        job_id     = str(uuid.uuid4())
        jobs[job_id] = {
            'id': job_id, 'status': 'queued', 'progress': 0,
            'output_url': None, 'output_path': None, 'error_text': None,
            'created_at': datetime.now().isoformat(), 'completed_at': None,
            'script': copy.dict(),
        }
        await job_queue.put((job_id, copy))
        result.append({'resolution': resolution, 'job_id': job_id})
    return {'ok': True, 'jobs': result}


@app.get('/status/{job_id}')
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, 'Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°')
    j = jobs[job_id]
    return {k: j.get(k) for k in ('id','status','progress','output_url','error_text','created_at','completed_at')}


@app.get('/preview/{job_id}')
async def get_preview(job_id: str):
    path = RENDER_DIR / job_id / 'preview.png'
    if not path.exists():
        raise HTTPException(404, 'РџСЂРµРІСЊСЋ РЅРµ РЅР°Р№РґРµРЅРѕ')
    return FileResponse(str(path), media_type='image/png')


@app.get('/frame/{job_id}')
async def get_frame(job_id: str, t: float = Query(0.0, ge=0.0)):
    """РР·РІР»РµРєР°РµС‚ РєР°РґСЂ РёР· РіРѕС‚РѕРІРѕРіРѕ РІРёРґРµРѕ РїРѕ РІСЂРµРјРµРЅРЅРѕР№ РјРµС‚РєРµ (СЃРµРєСѓРЅРґС‹)."""
    if job_id not in jobs:
        raise HTTPException(404, 'Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°')
    video_path = jobs[job_id].get('output_path')
    if not video_path or not Path(video_path).exists():
        raise HTTPException(404, 'Р’РёРґРµРѕ С„Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ')
    frame_path = str(RENDER_DIR / job_id / f'frame_{t:.2f}.png')
    if not Path(frame_path).exists():
        p = await asyncio.create_subprocess_exec(
            'ffmpeg', '-y', '-ss', str(t), '-i', video_path,
            '-vf', 'select=eq(n\\,0),scale=480:-2', '-frames:v', '1', '-update', '1', frame_path,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await p.wait()
    if not Path(frame_path).exists():
        raise HTTPException(500, 'РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РІР»РµС‡СЊ РєР°РґСЂ')
    return FileResponse(frame_path, media_type='image/png')


@app.get('/jobs')
async def list_jobs():
    result = sorted(
        [{'id': j['id'], 'status': j['status'], 'progress': j['progress'],
          'output_url': j.get('output_url'), 'created_at': j['created_at'],
          'completed_at': j.get('completed_at')}
         for j in jobs.values()],
        key=lambda x: x['created_at'], reverse=True,
    )
    return {'ok': True, 'jobs': result}


@app.delete('/job/{job_id}')
async def delete_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, 'Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°')
    job_dir = RENDER_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    del jobs[job_id]
    return {'ok': True}


@app.get('/luts')
async def list_luts():
    """РЎРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅС‹С… LUT-РїСЂРµСЃРµС‚РѕРІ СЃ РѕРїРёСЃР°РЅРёСЏРјРё."""
    return {
        'ok': True,
        'luts': [{'id': k, 'name': LUT_DESCRIPTIONS[k]} for k in LUT_PRESETS],
    }


@app.post('/analyze/bpm')
async def analyze_bpm(body: AnalyzeRequest):
    """РћРїСЂРµРґРµР»СЏРµС‚ BPM Рё РІСЂРµРјРµРЅРЅС‹МЂРµ РјРµС‚РєРё РґРѕР»РµР№ РёР· Р°СѓРґРёРѕС„Р°Р№Р»Р°."""
    job_dir = RENDER_DIR / 'bpm' / str(uuid.uuid4())
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        loop  = asyncio.get_event_loop()
        local = await loop.run_in_executor(None, download_source, body.source, job_dir)

        wav_path = str(job_dir / 'audio.wav')
        p = await asyncio.create_subprocess_exec(
            'ffmpeg', '-y', '-i', local, '-ar', '22050', '-ac', '1', '-f', 'wav', wav_path,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await p.wait()

        def _detect() -> tuple[float, list[float]]:
            import librosa  # noqa: PLC0415
            y, sr  = librosa.load(wav_path, sr=22050)
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
            return float(tempo), librosa.frames_to_time(beats, sr=sr).tolist()

        bpm, beat_times = await loop.run_in_executor(None, _detect)
        return {'ok': True, 'bpm': round(bpm, 1), 'beat_times': beat_times[:200]}
    finally:
        shutil.rmtree(str(job_dir), ignore_errors=True)


@app.post('/analyze/scenes')
async def analyze_scenes(body: AnalyzeRequest):
    """РћР±РЅР°СЂСѓР¶РёРІР°РµС‚ РјРѕРЅС‚Р°Р¶РЅС‹Рµ СЃРєР»РµР№РєРё РІ РІРёРґРµРѕС„Р°Р№Р»Рµ."""
    job_dir = RENDER_DIR / 'scenes' / str(uuid.uuid4())
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        loop  = asyncio.get_event_loop()
        local = await loop.run_in_executor(None, download_source, body.source, job_dir)

        def _detect() -> list[dict]:
            from scenedetect import open_video, SceneManager  # type: ignore  # noqa: PLC0415
            from scenedetect.detectors import ContentDetector  # type: ignore  # noqa: PLC0415
            video   = open_video(local)
            sm      = SceneManager()
            sm.add_detector(ContentDetector(threshold=27.0))
            sm.detect_scenes(video)
            return [
                {'start': round(s[0].get_seconds(), 3), 'end': round(s[1].get_seconds(), 3)}
                for s in sm.get_scene_list()
            ]

        scenes = await loop.run_in_executor(None, _detect)
        return {'ok': True, 'scenes': scenes, 'count': len(scenes)}
    finally:
        shutil.rmtree(str(job_dir), ignore_errors=True)


@app.get('/health')
async def health():
    return {'ok': True, 'service': 'montage', 'version': '2.0.0',
            'queue_size': job_queue.qsize(), 'jobs_count': len(jobs)}


@app.websocket('/ws/{job_id}')
async def ws_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in ws_subscribers:
        ws_subscribers[job_id] = set()
    ws_subscribers[job_id].add(websocket)
    logger.info(f'[WS] РџРѕРґРєР»СЋС‡С‘РЅ РєР»РёРµРЅС‚ РґР»СЏ job_id={job_id[:8]}')
    try:
        if job_id in jobs:
            j = jobs[job_id]
            await websocket.send_json({'status': j['status'], 'progress': j['progress']})
        while True:
            msg = await websocket.receive_text()
            if msg == 'ping':
                await websocket.send_text('pong')
    except WebSocketDisconnect:
        pass
    finally:
        ws_subscribers.get(job_id, set()).discard(websocket)


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8001, log_level='info')

