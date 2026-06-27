// ========== 番茄钟 PWA — 核心逻辑 ==========

// ----- 数据模型 -----
const TYPE = { work: 'work', break: 'break' };

class Preset {
  constructor(name, minutes, type) {
    this.name = name;
    this.duration = minutes * 60; // 秒
    this.type = type;
    this.isCurrent = false;
    this.index = 0;
  }
  get typeText() { return this.type === TYPE.work ? '🍅 工作' : '☕ 休息'; }
  get typeColor() { return this.type === TYPE.work ? '#E74C3C' : '#3498DB'; }
  get durationText() {
    const m = Math.floor(this.duration / 60);
    const s = this.duration % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
}

// 可用提示音
const SOUND_FILES = [
  { name: '🔔 提示音 1', file: '提示音1.wav', cat: '提示音', dur: '0:16' },
  { name: '🔔 提示音 2', file: '提示音2.wav', cat: '提示音', dur: '0:01' },
  { name: '🔔 提示音 3', file: '提示音3.wav', cat: '提示音', dur: '0:02' },
  { name: '🎵 音乐 1',  file: '音乐1.wav',  cat: '音乐', dur: '0:34' },
  { name: '🎵 音乐 2',  file: '音乐2.mp3',  cat: '音乐', dur: '3:16' },
  { name: '🎵 音乐 3',  file: '音乐3.wav',  cat: '音乐', dur: '1:43' },
];

// ----- 全局状态 -----
let presets = [];
let currentIndex = -1;
let isRunning = false;
let isPaused = false;
let timerEndTime = 0;
let pausedRemaining = 0;
let totalDuration = 0;
let timerInterval = null;
let alertAudio = null;
let selectedSound = SOUND_FILES[0].file;
let isPipActive = false;
let pipStream = null;

// ----- DOM 引用 -----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const presetList = $('#presetList');
const phaseLabel = $('#phaseLabel');
const presetName = $('#presetName');
const countdown = $('#countdown');
const progress = $('#progress');
const progressText = $('#progressText');
const startBtn = $('#startBtn');
const pauseBtn = $('#pauseBtn');
const resetBtn = $('#resetBtn');
const autoNextCb = $('#autoNextCb');
const loopCb = $('#loopCb');
const soundCb = $('#soundCb');
const soundSelect = $('#soundSelect');
const alertOverlay = $('#alertOverlay');
const alertNext = $('#alertNext');
const alertHint = $('#alertHint');
const pipBtn = $('#pipBtn');
const pipCanvas = $('#pipCanvas');
const pipVideo = $('#pipVideo');

// ========== 初始化 ==========
function init() {
  // 注册 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 加载自动保存或默认预设
  const saved = localStorage.getItem('pomodoro_autosave');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      presets = data.map(p => new Preset(p.name, Math.floor(p.duration / 60), p.type));
    } catch { loadDefaults(); }
  } else {
    loadDefaults();
  }

  if (presets.length === 0) loadDefaults();
  updateIndices();
  renderPresets();
  selectPreset(0);

  // 填充提示音选择器
  SOUND_FILES.forEach((sf, i) => {
    const opt = document.createElement('option');
    opt.value = sf.file;
    opt.textContent = `${sf.name} [${sf.dur}]`;
    soundSelect.appendChild(opt);
  });
  soundSelect.value = selectedSound;
  soundSelect.addEventListener('change', () => {
    selectedSound = soundSelect.value;
  });

  // 绑定事件
  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);
  alertOverlay.addEventListener('click', dismissAlert);
  $('#helpBtn').addEventListener('click', () => toggleModal('helpOverlay', true));
  $('#helpClose').addEventListener('click', () => toggleModal('helpOverlay', false));
  $('#saveBtn').addEventListener('click', openSaveDialog);
  $('#loadBtn').addEventListener('click', openLoadDialog);
  $('#saveCancel').addEventListener('click', () => toggleModal('saveOverlay', false));
  $('#saveConfirm').addEventListener('click', confirmSave);
  $('#loadClose').addEventListener('click', () => toggleModal('loadOverlay', false));
  $('#addBtn').addEventListener('click', addPreset);
  pipBtn.addEventListener('click', togglePip);
}

function loadDefaults() {
  presets = [
    new Preset('番茄 1', 25, TYPE.work),
    new Preset('短休息', 5, TYPE.break),
    new Preset('番茄 2', 25, TYPE.work),
    new Preset('长休息', 15, TYPE.break),
  ];
}

// ========== 预设渲染 ==========
function renderPresets() {
  presetList.innerHTML = '';
  presets.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `preset-item${p.isCurrent ? ' current' : ''}`;
    el.innerHTML = `
      <span class="idx">#${p.index}</span>
      <button class="type-btn ${p.type}" data-i="${i}">${p.typeText}</button>
      <div class="duration-box">
        <input class="dur-input" data-i="${i}" value="${p.durationText}" maxlength="5">
        <div class="dur-arrows">
          <button data-i="${i}" data-dir="up">▲</button>
          <button data-i="${i}" data-dir="down">▼</button>
        </div>
      </div>
      <button class="del-btn" data-i="${i}">✕</button>
    `;
    // 点击行选中
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      if (!isRunning || isPaused) selectPreset(i);
    });
    presetList.appendChild(el);
  });

  // 绑定按钮事件
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleType(parseInt(btn.dataset.i)));
  });
  $$('.dur-input').forEach(inp => {
    inp.addEventListener('change', () => {
      changeDuration(parseInt(inp.dataset.i), inp.value);
    });
    inp.addEventListener('focus', (e) => {
      if (isRunning && !isPaused) { e.target.blur(); }
    });
  });
  $$('.dur-arrows button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.i);
      const delta = btn.dataset.dir === 'up' ? 60 : -60; // ±1 分钟
      adjustDuration(i, delta);
    });
  });
  $$('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePreset(parseInt(btn.dataset.i));
    });
  });
}

function updateIndices() {
  presets.forEach((p, i) => { p.index = i + 1; });
}

// ========== 预设操作 ==========
function selectPreset(idx) {
  if (idx < 0 || idx >= presets.length) return;
  if (currentIndex >= 0 && currentIndex < presets.length)
    presets[currentIndex].isCurrent = false;
  currentIndex = idx;
  presets[idx].isCurrent = true;
  totalDuration = presets[idx].duration;
  updateTimerDisplay(totalDuration);
  updatePhaseDisplay();
  renderPresets();
  autosave();
}

function addPreset() {
  const last = presets.length > 0 ? presets[presets.length - 1] : null;
  const type = last && last.type === TYPE.work ? TYPE.break : TYPE.work;
  const dur = type === TYPE.work ? 25 : 5;
  presets.push(new Preset(`${type === TYPE.work ? '番茄' : '休息'} ${presets.length + 1}`, dur, type));
  updateIndices();
  renderPresets();
  if (!isRunning) selectPreset(currentIndex >= 0 ? currentIndex : 0);
  autosave();
}

function deletePreset(idx) {
  if (presets.length <= 1) return;
  presets.splice(idx, 1);
  updateIndices();
  if (currentIndex >= presets.length) currentIndex = presets.length - 1;
  if (currentIndex >= 0) presets[currentIndex].isCurrent = true;
  if (!isRunning) {
    if (currentIndex >= 0) {
      totalDuration = presets[currentIndex].duration;
      updateTimerDisplay(totalDuration);
    }
    updatePhaseDisplay();
  }
  renderPresets();
  autosave();
}

function toggleType(idx) {
  if (isRunning && !isPaused) return;
  const p = presets[idx];
  p.type = p.type === TYPE.work ? TYPE.break : TYPE.work;
  renderPresets();
  updatePhaseDisplay();
  autosave();
}

function changeDuration(idx, text) {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    renderPresets();
    return;
  }
  const mins = parseInt(match[1]);
  const secs = parseInt(match[2]);
  if (mins < 0 || mins > 99 || secs < 0 || secs > 59) {
    renderPresets();
    return;
  }
  presets[idx].duration = mins * 60 + secs;
  if (idx === currentIndex) {
    totalDuration = presets[idx].duration;
    if (!isRunning) updateTimerDisplay(totalDuration);
  }
  renderPresets();
  autosave();
}

function adjustDuration(idx, delta) {
  const p = presets[idx];
  p.duration = Math.max(60, Math.min(5940, p.duration + delta)); // 1s ~ 99min
  if (idx === currentIndex) {
    totalDuration = p.duration;
    if (!isRunning) updateTimerDisplay(totalDuration);
  }
  renderPresets();
  autosave();
}

// ========== 计时器核心 ==========
function startTimer() {
  if (presets.length === 0) return;
  if (currentIndex < 0 || currentIndex >= presets.length) selectPreset(0);
  if (isPaused) {
    totalDuration = presets[currentIndex].duration;
    timerEndTime = Date.now() + pausedRemaining * 1000;
    isPaused = false;
    pauseBtn.textContent = '⏸ 暂停';
  } else {
    totalDuration = presets[currentIndex].duration;
    timerEndTime = Date.now() + totalDuration * 1000;
  }
  isRunning = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  pipBtn.disabled = false;
  clearInterval(timerInterval);
  timerInterval = setInterval(tick, 200);
}

function pauseTimer() {
  if (!isRunning) return;
  if (isPaused) {
    timerEndTime = Date.now() + pausedRemaining * 1000;
    isPaused = false;
    pauseBtn.textContent = '⏸ 暂停';
    clearInterval(timerInterval);
    timerInterval = setInterval(tick, 200);
  } else {
    pausedRemaining = Math.max(0, (timerEndTime - Date.now()) / 1000);
    isPaused = true;
    pauseBtn.textContent = '▶ 继续';
    clearInterval(timerInterval);
  }
}

function resetTimer() {
  clearInterval(timerInterval);
  isRunning = false;
  isPaused = false;
  pauseBtn.textContent = '⏸ 暂停';
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  pipBtn.disabled = true;
  stopAlertSound();
  stopPip();
  if (currentIndex >= 0 && currentIndex < presets.length) {
    totalDuration = presets[currentIndex].duration;
    updateTimerDisplay(totalDuration);
    updatePhaseDisplay();
  }
}

function tick() {
  if (!isRunning || isPaused) return;
  const remaining = Math.max(0, (timerEndTime - Date.now()) / 1000);
  updateTimerDisplay(remaining);
  if (isPipActive) drawPipFrame();
  if (remaining <= 0) {
    onTimerFinished();
  }
}

function updateTimerDisplay(remaining) {
  const rem = Math.max(0, remaining);
  const m = Math.floor(rem / 60);
  const s = Math.floor(rem % 60);
  countdown.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  if (totalDuration > 0) {
    progress.style.width = `${(rem / totalDuration) * 100}%`;
  } else {
    progress.style.width = '100%';
  }

  const p = currentIndex >= 0 && currentIndex < presets.length ? presets[currentIndex] : null;
  if (p) {
    progress.className = p.type === TYPE.work ? 'progress-fill' : 'progress-fill break-bg';
  }

  let totalRemain = rem;
  for (let i = currentIndex + 1; i < presets.length; i++) {
    totalRemain += presets[i].duration;
  }
  const trH = Math.floor(totalRemain / 3600);
  const trM = Math.floor((totalRemain % 3600) / 60);
  const trS = Math.floor(totalRemain % 60);
  progressText.textContent =
    `第 ${currentIndex + 1} / ${presets.length} 段 · 总剩余 ${String(trH).padStart(2,'0')}:${String(trM).padStart(2,'0')}:${String(trS).padStart(2,'0')}`;
}

function updatePhaseDisplay() {
  if (currentIndex < 0 || currentIndex >= presets.length) return;
  const p = presets[currentIndex];
  if (p.type === TYPE.work) {
    phaseLabel.textContent = '🍅 工作中';
    phaseLabel.className = 'phase-label';
    progress.className = 'progress-fill';
  } else {
    phaseLabel.textContent = '☕ 休息中';
    phaseLabel.className = 'phase-label break';
    progress.className = 'progress-fill break-bg';
  }
  presetName.textContent = p.name;
}

function onTimerFinished() {
  clearInterval(timerInterval);
  isRunning = false;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  pipBtn.disabled = true;
  updateTimerDisplay(0);
  stopPip();

  // 显示提醒（提示音循环播放，等待用户点击关闭）
  showAlert();
}

function getNextIndex() {
  if (currentIndex + 1 < presets.length) return currentIndex + 1;
  if (loopCb.checked) return 0;
  return -1;
}

// ========== 全屏提醒 + 提示音 ==========
function showAlert() {
  const next = getNextIndex();
  if (next >= 0 && next < presets.length) {
    const np = presets[next];
    alertNext.textContent = `下一段：${np.typeText}  ${np.durationText}`;
    alertHint.textContent = '点击屏幕进入下一阶段';
  } else {
    alertNext.textContent = '全部计时完成！🎉';
    alertHint.textContent = '点击屏幕退出';
  }
  alertOverlay.classList.remove('hidden');

  if (soundCb.checked) {
    playAlertSound();
  }
}

function dismissAlert() {
  alertOverlay.classList.add('hidden');
  stopAlertSound();

  // 用户关闭提醒后，执行自动下一段逻辑
  if (autoNextCb.checked) {
    const next = getNextIndex();
    if (next >= 0) {
      selectPreset(next);
      startTimer();
      // 如果之前开着悬浮窗，重绘
      if (isPipActive) drawPipFrame();
    } else {
      resetTimer();
      updateTimerDisplay(presets[currentIndex]?.duration || 0);
    }
  } else {
    resetTimer();
    if (currentIndex >= 0 && currentIndex < presets.length) {
      updateTimerDisplay(presets[currentIndex].duration);
    }
  }
}

function playAlertSound() {
  stopAlertSound();
  try {
    alertAudio = new Audio(selectedSound);
    alertAudio.loop = true;
    alertAudio.play().catch(() => {
      // 自动播放被拦截，等用户交互
    });
  } catch (e) {
    // 音频不可用
  }
}

function stopAlertSound() {
  if (alertAudio) {
    alertAudio.pause();
    alertAudio.currentTime = 0;
    alertAudio = null;
  }
}

// ========== 保存 / 加载 ==========
function autosave() {
  const data = presets.map(p => ({
    name: p.name,
    duration: p.duration,
    type: p.type
  }));
  localStorage.setItem('pomodoro_autosave', JSON.stringify(data));
}

function openSaveDialog() {
  const now = new Date();
  const ts = `${now.getMonth()+1}-${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  $('#saveNameInput').value = `我的番茄钟 ${ts}`;
  toggleModal('saveOverlay', true);
  $('#saveNameInput').focus();
}

function confirmSave() {
  const name = $('#saveNameInput').value.trim();
  if (!name) return;
  const saved = getAllSaved();
  // 同名覆盖，最多 10 个
  const existIdx = saved.findIndex(s => s.name === name);
  if (existIdx >= 0) saved.splice(existIdx, 1);
  else if (saved.length >= 10) {
    alert('已达到 10 个上限，请先删除旧配置。');
    return;
  }
  saved.unshift({
    name,
    savedAt: new Date().toISOString(),
    presets: presets.map(p => ({ name: p.name, duration: p.duration, type: p.type }))
  });
  localStorage.setItem('pomodoro_saved', JSON.stringify(saved));
  toggleModal('saveOverlay', false);
  alert(`「${name}」已保存！`);
}

function openLoadDialog() {
  const saved = getAllSaved();
  const list = $('#loadList');
  if (saved.length === 0) {
    list.innerHTML = '<div class="load-empty">暂无已保存的配置</div>';
  } else {
    list.innerHTML = saved.map((s, i) => {
      const d = new Date(s.savedAt);
      const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const total = s.presets.reduce((sum, p) => sum + p.duration, 0);
      const m = Math.floor(total / 60);
      return `<div class="load-item" data-i="${i}">
        <div style="flex:1;min-width:0">
          <div class="load-name">${escHtml(s.name)}</div>
          <div class="load-date">${ts} · ${s.presets.length} 段 · 共 ${m} 分钟</div>
        </div>
        <button class="load-del-btn" data-i="${i}" title="删除">🗑</button>
      </div>`;
    }).join('');

    // 点击行加载
    $$('.load-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('load-del-btn')) return;
        const i = parseInt(item.dataset.i);
        loadPresets(i);
      });
    });
    // 删除按钮
    $$('.load-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.i);
        deleteSaved(i);
      });
    });
  }
  toggleModal('loadOverlay', true);
}

function deleteSaved(idx) {
  const saved = getAllSaved();
  if (idx < 0 || idx >= saved.length) return;
  const name = saved[idx].name;
  saved.splice(idx, 1);
  localStorage.setItem('pomodoro_saved', JSON.stringify(saved));
  openLoadDialog(); // 刷新列表
}

function loadPresets(idx) {
  const saved = getAllSaved();
  if (idx < 0 || idx >= saved.length) return;
  presets = saved[idx].presets.map(p => new Preset(p.name, Math.floor(p.duration / 60), p.type));
  resetTimer();
  updateIndices();
  currentIndex = -1;
  selectPreset(0);
  renderPresets();
  toggleModal('loadOverlay', false);
  autosave();
}

function getAllSaved() {
  try {
    return JSON.parse(localStorage.getItem('pomodoro_saved') || '[]');
  } catch { return []; }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 弹窗 ==========
function toggleModal(id, show) {
  const el = document.getElementById(id);
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

// ========== 画中画悬浮窗 ==========
function togglePip() {
  if (isPipActive) {
    stopPip();
  } else {
    startPip();
  }
}

async function startPip() {
  if (!document.pictureInPictureEnabled) {
    alert('你的浏览器不支持画中画悬浮窗。\n\n请使用 Chrome 浏览器，并在系统设置中允许悬浮窗权限。');
    return;
  }
  try {
    // 初始化 canvas → video 流
    const canvas = pipCanvas;
    const video = pipVideo;
    canvas.width = 400;
    canvas.height = 140;

    pipStream = canvas.captureStream(30); // 30fps
    video.srcObject = pipStream;
    video.playsInline = true;
    await video.play();

    // 进入画中画
    const pipWin = await video.requestPictureInPicture();
    isPipActive = true;
    pipBtn.textContent = '📌 关闭悬浮';
    pipBtn.classList.add('active');

    // 绘制第一帧
    drawPipFrame();

    // 监听画中画退出
    pipWin.addEventListener('leavepictureinpicture', () => {
      stopPip();
    });
  } catch (err) {
    console.warn('PiP 启动失败:', err);
    if (err.name === 'NotAllowedError') {
      alert('悬浮窗权限被拒绝。\n\n请在系统设置 → 应用 → 浏览器 → "显示在其他应用上层" 中开启权限。');
    } else {
      alert('悬浮窗启动失败，请重试。');
    }
    stopPip();
  }
}

function stopPip() {
  isPipActive = false;
  pipBtn.textContent = '📌 悬浮窗';
  pipBtn.classList.remove('active');

  if (pipStream) {
    pipStream.getTracks().forEach(t => t.stop());
    pipStream = null;
  }
  if (pipVideo.srcObject) {
    pipVideo.srcObject = null;
  }
  try { document.exitPictureInPicture(); } catch {}
}

// 兼容旧版 Chrome 的圆角矩形
function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPipFrame() {
  if (!isPipActive) return;
  const canvas = pipCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 背景
  ctx.fillStyle = '#1E1E2E';
  roundRect(ctx, 0, 0, w, h, 16);

  // 当前预设信息
  const p = currentIndex >= 0 && currentIndex < presets.length ? presets[currentIndex] : null;
  if (!p) {
    ctx.fillStyle = '#808090';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('未开始计时', w/2, h/2);
    return;
  }

  const isWork = p.type === TYPE.work;
  const remaining = isRunning ? Math.max(0, (timerEndTime - Date.now()) / 1000) : p.duration;
  const rm = Math.floor(remaining / 60);
  const rs = Math.floor(remaining % 60);
  const timeStr = `${String(rm).padStart(2,'0')}:${String(rs).padStart(2,'0')}`;
  const progressPct = p.duration > 0 ? remaining / p.duration : 1;

  // 左侧图标 + 阶段
  ctx.fillStyle = isWork ? '#E74C3C' : '#3498DB';
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(isWork ? '🍅' : '☕', 20, 62);

  // 阶段文字
  ctx.fillStyle = isWork ? '#E74C3C' : '#3498DB';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(isWork ? '工作中' : '休息中', 62, 52);

  // 倒计时
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 44px "Consolas","SF Mono",monospace';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, w - 20, 68);

  // 进度条背景
  const pbX = 20, pbY = 90, pbW = w - 40, pbH = 8, pbR = 4;
  ctx.fillStyle = '#2D2D44';
  roundRect(ctx, pbX, pbY, pbW, pbH, pbR);

  // 进度条填充
  const fillW = Math.max(pbR * 2, pbW * progressPct);
  ctx.fillStyle = isWork ? '#E74C3C' : '#3498DB';
  roundRect(ctx, pbX, pbY, fillW, pbH, pbR);

  // 底部信息
  ctx.fillStyle = '#808090';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  const subText = isRunning
    ? `第 ${currentIndex + 1}/${presets.length} 段 · ${p.name}`
    : (isPaused ? '⏸ 已暂停' : '⏹ 已停止');
  ctx.fillText(subText, w/2, 125);
}

// ========== 悬浮窗权限引导 ==========
function showPipPermissionGuide() {
  return confirm(
    '📌 迷你悬浮窗需要权限\n\n' +
    '请按以下步骤设置：\n' +
    '1. 打开系统「设置」\n' +
    '2. 进入「应用」→「应用管理」\n' +
    '3. 找到你的浏览器（Chrome/华为浏览器）\n' +
    '4. 点击「权限」→「悬浮窗」→ 选择「允许」\n\n' +
    '设置后返回本页面即可使用悬浮窗。\n\n' +
    '点击"确定"查看详细图文说明。'
  );
}

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', init);
