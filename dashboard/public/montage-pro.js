/**
 * Montage Pro — расширенные функции редактора монтажа v2.0
 *
 * Зависимости (глобальные переменные из index.html):
 *   api(method, url, body)    — обёртка над fetch
 *   socket                    — Socket.IO клиент
 *   toast(msg, type)          — уведомления
 *   openModal(id) / closeModal(id)
 *   tlTracks / tlRenderTracks / tlToMontageScript
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   1. WebSocket-прогресс (заменяет HTTP-поллинг)
   ═══════════════════════════════════════════════════════════ */

/**
 * Подписывается на прогресс рендера через Socket.IO.
 * Вызывается сразу после получения job_id.
 * @param {string} jobId
 * @param {Function} onProgress  (data) => void
 * @param {Function} onDone      (data) => void
 * @returns {Function} unsubscribe
 */
function montageWatchJob(jobId, onProgress, onDone) {
  function handler(data) {
    if (data.job_id !== jobId) return;
    onProgress(data);
    if (data.status === 'done' || data.status === 'error') {
      socket.off('montage:progress', handler);
      onDone(data);
    }
  }
  socket.on('montage:progress', handler);
  return () => socket.off('montage:progress', handler);
}

/**
 * Рисует или обновляет прогресс-бар рендера.
 * Предполагает наличие элементов с id=montage-pb-{jobId} и montage-pb-text-{jobId}.
 */
function montageUpdateProgress(data) {
  const bar  = document.getElementById(`montage-pb-${data.job_id}`);
  const text = document.getElementById(`montage-pb-text-${data.job_id}`);
  if (!bar || !text) return;
  bar.style.width  = `${data.progress || 0}%`;
  bar.setAttribute('aria-valuenow', data.progress || 0);
  const eta = data.eta ? ` • ETA ${data.eta}s` : '';
  const fps = data.fps ? ` • ${data.fps} fps` : '';
  text.textContent = data.status === 'done' ? '✅ Готово'
    : data.status === 'error' ? `❌ Ошибка: ${data.error || ''}`
    : `${data.progress || 0}%${fps}${eta}`;
}


/* ═══════════════════════════════════════════════════════════
   2. Аудио-волнограмма (Web Audio API)
   ═══════════════════════════════════════════════════════════ */

/**
 * Рисует волнограмму аудио-файла на <canvas>.
 * @param {string}              audioUrl  — URL аудиофайла
 * @param {HTMLCanvasElement}   canvas
 * @param {string}              [color='#6366f1']
 */
async function drawWaveform(audioUrl, canvas, color = '#6366f1') {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  canvas.style.cursor = 'wait';
  try {
    const buf      = await (await fetch(audioUrl)).arrayBuffer();
    const audioCtx = new AudioContext();
    const decoded  = await audioCtx.decodeAudioData(buf);
    const data     = decoded.getChannelData(0);
    const step     = Math.ceil(data.length / canvas.width);
    const mid      = canvas.height / 2;

    ctx.fillStyle = color;
    for (let i = 0; i < canvas.width; i++) {
      let peak = 0;
      for (let j = 0; j < step; j++) {
        const v = Math.abs(data[i * step + j] || 0);
        if (v > peak) peak = v;
      }
      const h = peak * canvas.height * 0.9;
      ctx.fillRect(i, mid - h / 2, 1, h);
    }
    await audioCtx.close();
  } catch (e) {
    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.fillText('Нет превью', 8, canvas.height / 2 + 4);
  }
  canvas.style.cursor = '';
}


/* ═══════════════════════════════════════════════════════════
   3. Парсер / импорт SRT
   ═══════════════════════════════════════════════════════════ */

/**
 * Преобразует строку SRT в массив { start, duration, text }.
 */
function parseSRT(srtText) {
  const blocks = srtText.trim().split(/\n\n+/);
  return blocks.map(block => {
    const lines = block.trim().split('\n');
    if (lines.length < 2) return null;
    // Пропустить строку с номером, если она состоит из цифр
    const timeLine = /-->/.test(lines[0]) ? lines[0] : lines[1];
    const textStart = /-->/.test(lines[0]) ? 1 : 2;
    if (!timeLine || !timeLine.includes('-->')) return null;

    const toSec = s => {
      const [h, m, rest] = s.trim().replace(',', '.').split(':');
      return +h * 3600 + +m * 60 + parseFloat(rest);
    };
    const [, from, to] = timeLine.match(/(.+?)\s*-->\s*(.+)/);
    const start    = toSec(from);
    const end      = toSec(to);
    const caption  = lines.slice(textStart).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!caption) return null;
    return { start, duration: Math.max(end - start, 0.2), text: caption };
  }).filter(Boolean);
}


/**
 * Импортирует .srt файл в текстовый трек таймлайна.
 * @param {File} file             — File-объект
 * @param {Array} tracksRef       — ссылка на tlTracks (или другой массив треков)
 * @param {Function} rerenderFn   — функция перерисовки (tlRenderTracks)
 */
function importSRTToTimeline(file, tracksRef, rerenderFn) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const clips = parseSRT(e.target.result);
    if (!clips.length) return toast('SRT не содержит субтитров', 'warning');

    let track = tracksRef.find(t => t.type === 'text');
    if (!track) {
      track = { id: `text_${Date.now()}`, type: 'text', clips: [] };
      tracksRef.push(track);
    }
    clips.forEach(c => {
      track.clips.push({
        id:         `srt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text:       c.text,
        start:      c.start,
        duration:   c.duration,
        trim_start: 0,
        keyframes:  [],
        effects:    { fade_in: 0.1, fade_out: 0.1, volume: 1, speed: 1, filters: [] },
        style:      {
          font: 'DejaVu Sans', size: 42, color: '#FFFFFF',
          bg_color: '#000000', bg_opacity: 0.6,
          position: 'bottom', animation: 'fade',
        },
      });
    });
    rerenderFn();
    toast(`Импортировано ${clips.length} субтитров`, 'success');
  };
  reader.readAsText(file);
}


/* ═══════════════════════════════════════════════════════════
   4. Шаблоны: экспорт / импорт JSON
   ═══════════════════════════════════════════════════════════ */

function exportTemplateJSON(scriptObj) {
  const blob = new Blob([JSON.stringify(scriptObj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: `montage_${Date.now()}.json`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/**
 * Читает .json шаблон и вызывает loadFn(scriptObject).
 */
function importTemplateJSON(file, loadFn) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      loadFn(JSON.parse(e.target.result));
      toast('Шаблон импортирован', 'success');
    } catch {
      toast('Ошибка: некорректный JSON файл', 'error');
    }
  };
  reader.readAsText(file);
}


/* ═══════════════════════════════════════════════════════════
   5. Мультиформатный экспорт
   ═══════════════════════════════════════════════════════════ */

const MULTI_FORMAT_PRESETS = [
  { id: '1080x1920', label: '9:16 — Shorts / Reels (1080×1920)' },
  { id: '1920x1080', label: '16:9 — YouTube (1920×1080)' },
  { id: '1080x1080', label: '1:1 — Лента (1080×1080)' },
  { id: '1080x1350', label: '4:5 — Instagram Feed (1080×1350)' },
];

function openMultiFormatModal() {
  const list = document.getElementById('mf-format-list');
  if (list && !list.dataset.built) {
    MULTI_FORMAT_PRESETS.forEach(p => {
      const lbl = document.createElement('label');
      lbl.className = 'flex items-center gap-2 cursor-pointer';
      lbl.innerHTML =
        `<input type="checkbox" class="checkbox checkbox-sm" value="${p.id}" checked> ${p.label}`;
      list.appendChild(lbl);
    });
    list.dataset.built = '1';
  }
  openModal('montage-multiformat-modal');
}


async function multiFormatExportConfirm(getScriptFn) {
  const checks = document.querySelectorAll('#mf-format-list input:checked');
  const resolutions = [...checks].map(el => el.value);
  if (!resolutions.length) return toast('Выберите хотя бы один формат', 'warning');

  const btn = document.getElementById('mf-confirm-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Запуск…';

  const out = document.getElementById('mf-jobs-output');
  out.innerHTML = '';

  try {
    const data = await api('POST', '/api/montage/render/multi', {
      script: getScriptFn(),
      resolutions,
    });
    if (!data.ok) throw new Error(data.error || 'Ошибка запуска');

    data.jobs.forEach(j => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 mt-1';
      row.innerHTML = `
        <span class="text-xs opacity-60 w-28">${j.resolution}</span>
        <div class="flex-1 bg-base-200 rounded h-3 overflow-hidden">
          <div id="montage-pb-${j.job_id}" class="h-3 bg-primary transition-all" style="width:0%"></div>
        </div>
        <span id="montage-pb-text-${j.job_id}" class="text-xs w-16 text-right">0%</span>`;
      out.appendChild(row);
      montageWatchJob(j.job_id, montageUpdateProgress, d => {
        if (d.status === 'done') toast(`✅ ${j.resolution} — готово`, 'success');
      });
    });
    toast(`Запущено ${data.jobs.length} рендеров`, 'success');
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
  } finally {
    btn.disabled   = false;
    btn.textContent = '▶ Запустить рендер';
  }
}


/* ═══════════════════════════════════════════════════════════
   6. AI-генерация скрипта
   ═══════════════════════════════════════════════════════════ */

function openAIGenerateModal() {
  openModal('montage-ai-modal');
}


async function aiGenerateConfirm(onScriptReceived) {
  const promptEl   = document.getElementById('ai-gen-prompt');
  const durationEl = document.getElementById('ai-gen-duration');
  const aspectEl   = document.getElementById('ai-gen-aspect');
  const styleEl    = document.getElementById('ai-gen-style');
  const btn        = document.getElementById('ai-gen-btn');

  const prompt = promptEl?.value?.trim();
  if (!prompt) return toast('Введите описание видео', 'warning');

  btn.disabled     = true;
  btn.textContent  = '⏳ Генерирую…';
  btn.classList.add('loading');

  try {
    const data = await api('POST', '/api/montage/ai-generate', {
      prompt,
      duration: parseInt(durationEl?.value) || 30,
      aspect:   aspectEl?.value  || '9:16',
      style:    styleEl?.value   || 'dynamic',
    });
    if (!data.ok) throw new Error(data.error || 'Ошибка генерации');
    onScriptReceived(data.data);
    closeModal('montage-ai-modal');
    toast('✨ Скрипт сгенерирован!', 'success');
  } catch (e) {
    toast('Ошибка AI: ' + e.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '✨ Сгенерировать';
    btn.classList.remove('loading');
  }
}


/* ═══════════════════════════════════════════════════════════
   7. История версий
   ═══════════════════════════════════════════════════════════ */

let _versionsCurrentScriptId = null;

async function openVersionHistoryModal(scriptId) {
  _versionsCurrentScriptId = scriptId;
  const container = document.getElementById('versions-list');
  if (container) container.innerHTML = '<div class="loading loading-spinner loading-sm"></div>';
  openModal('montage-versions-modal');

  try {
    const data = await api('GET', `/api/montage/scripts/${scriptId}/versions`);
    if (!container) return;
    if (!data.ok || !data.data.length) {
      container.innerHTML = '<p class="text-sm opacity-60">Нет сохранённых версий</p>';
      return;
    }
    container.innerHTML = data.data.map(v => `
      <div class="flex items-center justify-between p-2 bg-base-200 rounded mb-1">
        <div>
          <span class="font-mono text-xs opacity-60">v${v.version_num}</span>
          <span class="ml-2 text-sm">${v.name || 'Автосохранение'}</span>
          <span class="ml-2 text-xs opacity-50">${new Date(v.created_at).toLocaleString('ru')}</span>
        </div>
        <button class="btn btn-xs btn-outline"
          onclick="versionRestore(${scriptId}, ${v.version_num})">Восстановить</button>
      </div>`
    ).join('');
  } catch (e) {
    if (container) container.innerHTML = `<p class="text-error text-sm">${e.message}</p>`;
  }
}


async function versionRestore(scriptId, ver) {
  if (!confirm(`Восстановить версию v${ver}? Текущие изменения будут перезаписаны.`)) return;
  try {
    await api('POST', `/api/montage/scripts/${scriptId}/restore/${ver}`);
    toast('Версия восстановлена', 'success');
    closeModal('montage-versions-modal');
    if (typeof montageLoadScripts === 'function') montageLoadScripts();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}


/* ═══════════════════════════════════════════════════════════
   8. BPM-анализ и авто-синк
   ═══════════════════════════════════════════════════════════ */

let _bpmResult = null;

async function bpmAnalyze(sourceUrl) {
  if (!sourceUrl) return toast('Укажите URL аудио', 'warning');
  const btn = document.getElementById('bpm-analyze-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализ…'; }

  try {
    const data = await api('POST', '/api/montage/analyze/bpm', { source: sourceUrl });
    if (!data.ok) throw new Error(data.error);
    _bpmResult = data;
    const el = document.getElementById('bpm-result');
    if (el) el.textContent = `BPM: ${data.bpm} • ${data.beat_times.length} долей`;
    toast(`🥁 BPM: ${data.bpm}`, 'success');
  } catch (e) {
    toast('BPM-анализ: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Анализировать'; }
  }
}


/**
 * Выравнивает длительности клипов видеотрека под доли BPM.
 */
function bpmSnapClips(tracksRef, rerenderFn) {
  if (!_bpmResult?.beat_times?.length)
    return toast('Сначала выполните BPM-анализ', 'warning');
  const beats = _bpmResult.beat_times;
  const vTrack = tracksRef.find(t => t.type === 'video');
  if (!vTrack?.clips?.length) return toast('Нет видеоклипов для синхронизации', 'warning');
  vTrack.clips.forEach((clip, i) => {
    const beatIdx = Math.round(clip.start * beats.length / (beats[beats.length - 1] || 1));
    const snapTo  = beats[Math.min(beatIdx, beats.length - 1)] ?? clip.start;
    clip.start    = parseFloat(snapTo.toFixed(3));
    if (i > 0) {
      const beat2 = beats[i] ?? clip.start + clip.duration;
      clip.duration = parseFloat(Math.max(beat2 - clip.start, 0.3).toFixed(3));
    }
  });
  rerenderFn();
  toast(`Клипы синхронизированы с BPM ${_bpmResult.bpm}`, 'success');
}


/* ═══════════════════════════════════════════════════════════
   9. Автодетекция сцен
   ═══════════════════════════════════════════════════════════ */

async function sceneDetect(sourceUrl, tracksRef, rerenderFn) {
  if (!sourceUrl) return toast('Укажите URL видео', 'warning');
  const btn = document.getElementById('scene-detect-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализ сцен…'; }

  try {
    const data = await api('POST', '/api/montage/analyze/scenes', { source: sourceUrl });
    if (!data.ok) throw new Error(data.error);

    let vTrack = tracksRef.find(t => t.type === 'video');
    if (!vTrack) {
      vTrack = { id: 'video', type: 'video', clips: [] };
      tracksRef.unshift(vTrack);
    }
    vTrack.clips = data.scenes.map((s, i) => ({
      id:         `scene_${i}_${Date.now()}`,
      source:     sourceUrl,
      start:      parseFloat(s.start.toFixed(3)),
      duration:   parseFloat(Math.max(s.end - s.start, 0.1).toFixed(3)),
      trim_start: parseFloat(s.start.toFixed(3)),
      trim_end:   parseFloat(s.end.toFixed(3)),
      keyframes:  [],
      effects:    { fade_in: 0, fade_out: 0, volume: 1, speed: 1, filters: [] },
    }));
    rerenderFn();
    const sceneEl = document.getElementById('scene-detect-result');
    if (sceneEl) sceneEl.textContent = `Найдено: ${data.count} сцен`;
    toast(`🔍 Найдено ${data.count} сцен`, 'success');
  } catch (e) {
    toast('Детекция сцен: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Найти сцены'; }
  }
}


/* ═══════════════════════════════════════════════════════════
   10. Frame-scrubber
   ═══════════════════════════════════════════════════════════ */

let _scrubDebounce = null;

/**
 * Загружает кадр из готового видео и показывает его в previewEl (img или div).
 */
function scrubFrame(jobId, timeSec, previewEl) {
  clearTimeout(_scrubDebounce);
  _scrubDebounce = setTimeout(async () => {
    try {
      const url  = `/api/montage/frame/${jobId}?t=${timeSec}&_=${Date.now()}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const src  = URL.createObjectURL(blob);
      if (previewEl.tagName === 'IMG') {
        const old = previewEl.src;
        previewEl.src = src;
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      } else {
        previewEl.style.backgroundImage = `url(${src})`;
      }
    } catch {}
  }, 150);
}


/* ═══════════════════════════════════════════════════════════
   11. Расширенная панель свойств клипа (LUT / chroma / stabilize)
   ═══════════════════════════════════════════════════════════ */

let _lutsCache = null;

async function loadLUTs() {
  if (_lutsCache) return _lutsCache;
  try {
    const data = await api('GET', '/api/montage/luts');
    _lutsCache = data.ok ? data.luts : [];
  } catch {
    _lutsCache = [];
  }
  return _lutsCache;
}


/**
 * Рендерит дополнительные контролы в контейнер el для клипа clip.
 * Изменения применяются напрямую в объект clip.effects.
 * @param {HTMLElement}  el      — контейнер для вставки
 * @param {Object}       clip    — объект клипа (мутируется)
 * @param {Function}     onChange — вызывается после каждого изменения
 */
async function renderClipProControls(el, clip, onChange) {
  const luts = await loadLUTs();
  const eff  = clip.effects || (clip.effects = {});

  el.innerHTML = `
    <div class="divider text-xs my-1">Цветокоррекция</div>

    <label class="label label-text text-xs pb-0">LUT-пресет</label>
    <select id="cp-lut" class="select select-xs select-bordered w-full">
      <option value="">— Без обработки —</option>
      ${luts.map(l => `<option value="${l.id}" ${eff.lut_preset === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
    </select>

    <div class="divider text-xs my-1">Chroma Key (хромакей)</div>

    <label class="label cursor-pointer pb-0">
      <span class="label-text text-xs">Включить хромакей</span>
      <input type="checkbox" class="toggle toggle-xs" id="cp-chroma-toggle"
        ${eff.chroma_key_color ? 'checked' : ''}>
    </label>
    <div id="cp-chroma-opts" class="${eff.chroma_key_color ? '' : 'hidden'} flex gap-2 mt-1">
      <div class="flex-1">
        <label class="label-text text-xs">Цвет фона</label>
        <input type="color" id="cp-chroma-color" class="w-full h-7 cursor-pointer rounded"
          value="${eff.chroma_key_color || '#00FF00'}">
      </div>
      <div class="flex-1">
        <label class="label-text text-xs">Допуск</label>
        <input type="range" id="cp-chroma-sim" min="0.01" max="0.5" step="0.01" class="range range-xs"
          value="${eff.chroma_key_sim ?? 0.15}">
      </div>
    </div>

    <div class="divider text-xs my-1">Стабилизация</div>
    <label class="label cursor-pointer pb-0">
      <span class="label-text text-xs">Vidstab (2-проходная)</span>
      <input type="checkbox" class="toggle toggle-xs toggle-warning" id="cp-stabilize"
        ${eff.stabilize ? 'checked' : ''}>
    </label>
    <p class="text-xs opacity-50">Увеличивает время рендера</p>
  `;

  el.querySelector('#cp-lut').addEventListener('change', e => {
    eff.lut_preset = e.target.value || null;
    onChange();
  });
  const toggle = el.querySelector('#cp-chroma-toggle');
  const opts   = el.querySelector('#cp-chroma-opts');
  toggle.addEventListener('change', () => {
    opts.classList.toggle('hidden', !toggle.checked);
    eff.chroma_key_color = toggle.checked
      ? (el.querySelector('#cp-chroma-color').value || '#00FF00')
      : null;
    onChange();
  });
  el.querySelector('#cp-chroma-color').addEventListener('input', e => {
    eff.chroma_key_color = e.target.value;
    onChange();
  });
  el.querySelector('#cp-chroma-sim').addEventListener('input', e => {
    eff.chroma_key_sim = parseFloat(e.target.value);
    onChange();
  });
  el.querySelector('#cp-stabilize').addEventListener('change', e => {
    eff.stabilize = e.target.checked;
    onChange();
  });
}


/* ═══════════════════════════════════════════════════════════
   12. Редактор ключевых кадров (мини‑таймлайн)
   ═══════════════════════════════════════════════════════════ */

/**
 * Рендерит редактор ключевых кадров в контейнер containerEl.
 * Изменения записываются прямо в clip.keyframes.
 *
 * @param {HTMLElement} containerEl
 * @param {Object}      clip          — { duration, keyframes: [] }
 * @param {Function}    onChange
 */
function renderKeyframeEditor(containerEl, clip, onChange) {
  const dur  = clip.duration || 5;
  clip.keyframes = clip.keyframes || [];

  function rebuildUI() {
    containerEl.innerHTML = `
      <div class="divider text-xs my-1">Ключевые кадры (Ken Burns)</div>
      <div id="kf-track" class="relative bg-base-200 h-6 rounded cursor-crosshair select-none"
           title="Кликните для добавления ключевого кадра">
        ${clip.keyframes.map((kf, i) => `
          <div class="kf-dot absolute top-0 h-6 w-2 bg-warning rounded cursor-pointer"
               style="left:${(kf.time / dur * 100).toFixed(1)}%; margin-left:-4px"
               data-idx="${i}" title="t=${kf.time.toFixed(2)}s"></div>
        `).join('')}
      </div>
      <div id="kf-props" class="mt-1 text-xs opacity-70">Нажмите на кадр для редактирования</div>
      <button class="btn btn-xs btn-ghost mt-1" onclick="this.closest('[data-kfe]').dispatchEvent(new Event('kf:clear'))">
        ✕ Сбросить</button>
    `;

    const track = containerEl.querySelector('#kf-track');
    const props = containerEl.querySelector('#kf-props');

    track.addEventListener('click', e => {
      if (e.target.classList.contains('kf-dot')) return;
      const rect = track.getBoundingClientRect();
      const t    = parseFloat(((e.clientX - rect.left) / rect.width * dur).toFixed(3));
      clip.keyframes.push({ time: t, scale: 1.0, x: 0, y: 0, opacity: 1 });
      clip.keyframes.sort((a, b) => a.time - b.time);
      rebuildUI();
      onChange();
    });

    track.querySelectorAll('.kf-dot').forEach(dot => {
      dot.addEventListener('click', e => {
        e.stopPropagation();
        const i  = parseInt(dot.dataset.idx);
        const kf = clip.keyframes[i];
        props.innerHTML = `
          <div class="grid grid-cols-2 gap-1">
            <label>Зум <input type="number" step="0.05" min="0.5" max="3" value="${kf.scale.toFixed(2)}"
              class="input input-xs w-full" id="kf-scale"></label>
            <label>Сдвиг X <input type="number" step="0.01" min="-0.5" max="0.5" value="${kf.x.toFixed(3)}"
              class="input input-xs w-full" id="kf-x"></label>
            <label>Сдвиг Y <input type="number" step="0.01" min="-0.5" max="0.5" value="${kf.y.toFixed(3)}"
              class="input input-xs w-full" id="kf-y"></label>
            <label>t=${kf.time.toFixed(2)}s
              <button class="btn btn-xs btn-error w-full mt-0.5" id="kf-del">Удалить</button>
            </label>
          </div>`;
        props.querySelector('#kf-scale').oninput = ev => { kf.scale = +ev.target.value; onChange(); };
        props.querySelector('#kf-x').oninput     = ev => { kf.x = +ev.target.value; onChange(); };
        props.querySelector('#kf-y').oninput     = ev => { kf.y = +ev.target.value; onChange(); };
        props.querySelector('#kf-del').onclick   = () => {
          clip.keyframes.splice(i, 1);
          rebuildUI();
          onChange();
        };
      });
    });
  }

  containerEl.dataset.kfe = '1';
  containerEl.addEventListener('kf:clear', () => {
    clip.keyframes = [];
    rebuildUI();
    onChange();
  }, { once: false });

  rebuildUI();
}


/* ═══════════════════════════════════════════════════════════
   Экспорт глобальных функций (доступны из index.html)
   ═══════════════════════════════════════════════════════════ */

Object.assign(window, {
  // WS-прогресс
  montageWatchJob,
  montageUpdateProgress,
  // Аудио
  drawWaveform,
  // SRT
  parseSRT,
  importSRTToTimeline,
  // Шаблоны
  exportTemplateJSON,
  importTemplateJSON,
  // Мультиформат
  openMultiFormatModal,
  multiFormatExportConfirm,
  // AI
  openAIGenerateModal,
  aiGenerateConfirm,
  // Версии
  openVersionHistoryModal,
  versionRestore,
  // BPM
  bpmAnalyze,
  bpmSnapClips,
  // Сцены
  sceneDetect,
  // Scrubber
  scrubFrame,
  // Пресеты (клип)
  renderClipProControls,
  // Keyframes
  renderKeyframeEditor,
});
