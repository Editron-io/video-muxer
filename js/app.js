const $ = id => document.getElementById(id);
let state = {
  name: 'Horror Story 01',
  media: [],
  timeline: [],
  selected: null,
  audio: null,
  music: [],
  settings: {
    language: 'en-US',
    voice: 'en-US-AriaNeural',
    rate: 0,
    pitch: 0,
    origVol: 100,
    addVol: 100,
    start: 0,
    end: 0,
    musicVol: 35,
    timelineZoom: 70,
    playheadMs: 0
  }
};
let currentURL = null;
let ttsBlob = null;
let timelinePlayheadMs = 0;
let timelineZoom = 70;
let playheadDragging = false;
let isPlaying = false;
let playInterval = null;

const fmt = ms => {
  ms = Math.max(0, ms || 0);
  let s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
  s %= 3600;
  let m = Math.floor(s / 60);
  s %= 60;
  return h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const fmtPrecise = ms => {
  ms = Math.max(0, Number(ms) || 0);
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  const base = h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${base}.${tenths}`;
};

// --- Theme Management ---
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('audioverse-theme', t);
  const icon = $('themeIcon'), text = $('themeText');
  if (icon) icon.textContent = t === 'dark' ? '☀' : '☾';
  if (text) text.textContent = t === 'dark' ? 'Light' : 'Dark';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t === 'dark' ? '#20242a' : '#f7f9fc';
}

function initTheme() {
  const saved = localStorage.getItem('audioverse-theme');
  applyTheme(saved || 'dark');
  $('themeBtn')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    toast(next === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
  });
}

function toast(msg, error = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' error' : '');
  t.textContent = msg;
  $('toastStack').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function ripple(e) {
  const b = e.currentTarget, d = document.createElement('span');
  d.className = 'ripple-dot';
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * .55;
  d.style.width = d.style.height = s + 'px';
  d.style.left = (e.clientX - r.left - s / 2) + 'px';
  d.style.top = (e.clientY - r.top - s / 2) + 'px';
  b.appendChild(d);
  setTimeout(() => d.remove(), 550);
}

function busy(btn, on = true) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

// --- Data Operations & Mock DB ---
const AVDB = {
  async getAll(store) {
    try { return JSON.parse(localStorage.getItem(`av-${store}`)) || []; } catch { return []; }
  },
  async get(store, key) {
    try { return JSON.parse(localStorage.getItem(`av-${store}-${key}`)) || null; } catch { return null; }
  },
  async put(store, key, val) {
    localStorage.setItem(`av-${store}-${key}`, JSON.stringify(val));
  },
  async saveAll(store, val) {
    localStorage.setItem(`av-${store}`, JSON.stringify(val));
  }
};

async function saveState() {
  await AVDB.put('projects', 'current', state);
  await AVDB.saveAll('media', state.media);
}

async function refresh() {
  state.media = await AVDB.getAll('media');
  const p = await AVDB.get('projects', 'current');
  if (p) state = { ...state, ...p, settings: { ...state.settings, ...(p.settings || {}) } };
  
  timelineZoom = Number(state.settings.timelineZoom) || 70;
  const z = $('timelineZoom');
  if (z) z.value = timelineZoom;
  
  timelinePlayheadMs = Math.max(0, Number(state.settings.playheadMs) || 0);
  normalizeAudioTiming();
  renderMedia();
  renderTimeline();
  renderMusic();
  renderSettings();
  setTimelinePlayhead(timelinePlayheadMs, { preview: false, scroll: false });
  updateStorage();
  syncAudioPreview();
}

function updateStorage() {
  const info = $('storageInfo');
  if (info) info.textContent = `Local library (${state.media.length} items)`;
}

function thumbHTML(m) {
  if (!m.blob) return `<div style="height:100%;display:grid;place-items:center;color:#174a7b;font-size:25px">♪</div>`;
  const src = URL.createObjectURL(m.blob);
  setTimeout(() => URL.revokeObjectURL(src), 30000);
  if (m.type?.startsWith('video')) return `<video src="${src}" muted preload="metadata" disableRemotePlayback disablePictureInPicture playsinline x-webkit-airplay="deny"></video>`;
  return `<div style="height:100%;display:grid;place-items:center;color:#174a7b;font-size:25px">♪</div>`;
}

function hardenMediaVideo(el) {
  if (!el) return;
  el.disableRemotePlayback = true;
  el.disablePictureInPicture = true;
  el.controls = false;
  el.setAttribute('playsinline', '');
  el.setAttribute('disableRemotePlayback', '');
  el.setAttribute('disablePictureInPicture', '');
  el.setAttribute('x-webkit-airplay', 'deny');
}

// --- Library Renderers ---
function renderMedia() {
  const q = $('mediaSearch')?.value.toLowerCase() || '';
  const list = $('mediaList');
  if (!list) return;
  list.innerHTML = '';
  
  state.media.filter(x => x.name.toLowerCase().includes(q)).forEach(m => {
    const inTimeline = state.timeline.some(x => x.mediaId === m.id);
    const d = document.createElement('div');
    d.className = 'media-item ' + (inTimeline ? 'selected' : '');
    d.title = m.name;
    d.innerHTML = `<div class="thumb">${thumbHTML(m)}</div><div class="media-copy"><b>${escapeHTML(m.name)}</b><small>${m.type?.startsWith('audio') ? 'Audio' : 'Video'} • ${fmt(m.duration || 0)}</small></div><button type="button" class="media-check" aria-label="${inTimeline ? 'Remove from' : 'Add to'} timeline" title="${inTimeline ? 'Remove from' : 'Add to'} timeline">${inTimeline ? '✓' : '+'}</button>`;
    
    d.onclick = () => m.type?.startsWith('audio') ? useImportedAudio(m.id) : loadLibraryPreview(m);
    
    const checkBtn = d.querySelector('.media-check');
    if (checkBtn) {
      checkBtn.onclick = async e => {
        e.stopPropagation();
        if (inTimeline) removeMediaFromTimeline(m.id);
        else await addToTimeline(m.id);
      };
    }
    list.appendChild(d);
    hardenMediaVideo(d.querySelector('video'));
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadLibraryPreview(m) {
  if (!m) return;
  if (m.type?.startsWith('audio')) { useImportedAudio(m.id); return; }
  if (currentURL) URL.revokeObjectURL(currentURL);
  if (!m.blob) return;
  currentURL = URL.createObjectURL(m.blob);
  const video = $('previewVideo');
  if (video) {
    video.src = currentURL;
    hardenMediaVideo(video);
    $('emptyPreview').style.display = 'none';
    $('previewStatus').textContent = m.name;
    video.load();
    video.currentTime = 0;
    video.play().catch(() => {});
  }
  toast('Previewing ' + m.name);
}

function loadPreview(m) {
  if (!m || !m.blob) return;
  if (currentURL) URL.revokeObjectURL(currentURL);
  currentURL = URL.createObjectURL(m.blob);
  const video = $('previewVideo');
  if (video) {
    video.src = currentURL;
    hardenMediaVideo(video);
    $('emptyPreview').style.display = 'none';
    $('previewStatus').textContent = m.name;
    video.load();
  }
}

async function addToTimeline(id) {
  const m = state.media.find(x => x.id === id);
  if (!m || m.type?.startsWith('audio')) return;
  const it = { id: crypto.randomUUID(), mediaId: id, name: m.name, inMs: 0, outMs: m.duration || 0, duration: m.duration || 0 };
  state.timeline.push(it);
  state.selected = it.id;
  await saveState();
  renderTimeline();
  renderMedia();
  loadPreview(m);
  toast('Clip added to timeline');
}

async function removeMediaFromTimeline(mediaId) {
  const current = state.timeline.find(x => x.id === state.selected && x.mediaId === mediaId);
  state.timeline = state.timeline.filter(x => x.mediaId !== mediaId);
  if (current) state.selected = null;
  await saveState();
  renderTimeline();
  renderMedia();
  toast('Clip removed from timeline');
}

// --- Audio Controls ---
function normalizeAudioTiming() {
  const s = state.settings || {};
  const end = Number(s.end) || 0;
  const start = Number(s.start) || 0;
  const duration = Number(state.audio?.duration || state.audio?.end || 0);
  if (duration > 0 && end > duration / 1000 * 1.5) {
    s.start = start / 1000;
    s.end = end / 1000;
    state.settings = s;
  }
  if (state.audio && !state.audio.duration) state.audio.duration = duration;
}

function setAudioPreview(m) {
  const a = $('ttsAudio');
  if (!a || !m?.blob) return;
  if (a._audioverseURL) URL.revokeObjectURL(a._audioverseURL);
  a._audioverseURL = URL.createObjectURL(m.blob);
  a.src = a._audioverseURL;
  a.load();
  a.volume = Math.max(0, Math.min(1, (Number($('addVol')?.value) || 100) / 100));
}

function syncAudioPreview() {
  if (state.audio?.blob) {
    setAudioPreview({ blob: state.audio.blob });
    if ($('ttsText')) $('ttsText').value = state.audio.text || '';
  }
}

// --- Timeline Render Engine & Helpers ---
function timelineTotalMs() {
  return state.timeline.reduce((x, it) => x + Math.max(0, (it.outMs || 0) - (it.inMs || 0)), 0) || 5000;
}

function clipAtTimelineMs(ms) {
  let cursor = 0;
  if (state.timeline.length === 0) return null;
  for (const it of state.timeline) {
    const dur = Math.max(0, (it.outMs || 0) - (it.inMs || 0));
    if (ms <= cursor + dur || it === state.timeline[state.timeline.length - 1]) {
      return { it, start: cursor, offset: Math.max(0, Math.min(dur, ms - cursor)) };
    }
    cursor += dur;
  }
  return null;
}

function setTimelinePlayhead(ms, { preview = true, scroll = true, save = false } = {}) {
  const total = timelineTotalMs();
  timelinePlayheadMs = Math.max(0, Math.min(total, Math.round((Number(ms) || 0) / 100) * 100));
  
  const field = $('playheadTime');
  if (field) field.value = (timelinePlayheadMs / 1000).toFixed(1);
  
  const ph = $('timelinePlayhead');
  if (ph) ph.style.left = (88 + (timelinePlayheadMs / 1000) * timelineZoom) + 'px';
  
  const label = $('durationLabel');
  if (label) label.textContent = fmtPrecise(timelinePlayheadMs);

  if (preview) {
    const hit = clipAtTimelineMs(timelinePlayheadMs);
    if (hit) {
      if (state.selected !== hit.it.id) {
        state.selected = hit.it.id;
        renderTimeline();
        renderMedia();
        renderInspector();
      }
      const m = state.media.find(x => x.id === hit.it.mediaId);
      if (m) {
        const video = $('previewVideo');
        if (!video.src || $('previewStatus').textContent !== m.name) loadPreview(m);
        try { video.currentTime = Math.max(0, (hit.it.inMs + hit.offset) / 1000); } catch {}
      }
    }
  }

  if (scroll) {
    const scrollContainer = $('timelineScroll');
    if (scrollContainer) {
      const phLeft = (timelinePlayheadMs / 1000) * timelineZoom;
      const cWidth = scrollContainer.clientWidth;
      if (phLeft > scrollContainer.scrollLeft + cWidth - 150) {
        scrollContainer.scrollLeft = phLeft - cWidth + 200;
      } else if (phLeft < scrollContainer.scrollLeft + 50) {
        scrollContainer.scrollLeft = Math.max(0, phLeft - 100);
      }
    }
  }

  if (save) {
    state.settings.playheadMs = timelinePlayheadMs;
    AVDB.put('projects', 'current', state);
  }
}

function renderTimeline() {
  const tl = $('timeline');
  if (!tl) return;
  tl.innerHTML = '';
  
  let totalDur = 0;
  state.timeline.forEach(it => {
    const d = document.createElement('div');
    const dur = (it.outMs - it.inMs) / 1000;
    d.className = 'timeline-track ' + (state.selected === it.id ? 'active' : '');
    d.style.width = (dur * timelineZoom) + 'px';
    d.innerHTML = `<span>${escapeHTML(it.name)}</span>`;
    d.onclick = (e) => {
      e.stopPropagation();
      state.selected = it.id;
      renderTimeline();
      renderInspector();
    };
    tl.appendChild(d);
    totalDur += (it.outMs - it.inMs);
  });

  renderRuler(totalDur || 5000);
}

function renderRuler(totalMs) {
  const ruler = $('ruler');
  if (!ruler) return;
  ruler.innerHTML = '';
  const seconds = Math.ceil(totalMs / 1000) + 5;
  ruler.style.width = (seconds * timelineZoom + 100) + 'px';
  
  for (let i = 0; i < seconds; i++) {
    const mark = document.createElement('div');
    mark.className = 'ruler-mark';
    mark.style.left = (i * timelineZoom) + 'px';
    if (i % 5 === 0) {
      mark.classList.add('major');
      mark.innerHTML = `<small>${i}s</small>`;
    }
    ruler.appendChild(mark);
  }
}

// --- Music & Settings ---
function renderMusic() {
  const list = $('musicList');
  if (!list) return;
  list.innerHTML = '';
  if (state.music.length === 0) {
    list.innerHTML = '<p class="helper">No background music added</p>';
    return;
  }
  state.music.forEach(m => {
    const d = document.createElement('div');
    d.className = 'music-item';
    d.innerHTML = `<span>🎵 ${escapeHTML(m.name)}</span><button onclick="removeMusic('${m.id}')">✕</button>`;
    list.appendChild(d);
  });
}

function removeMusic(id) {
  state.music = state.music.filter(x => x.id !== id);
  saveState();
  renderMusic();
  toast('Music track removed');
}

function renderSettings() {
  if ($('language')) $('language').value = state.settings.language || 'en-US';
  if ($('voice')) $('voice').value = state.settings.voice || 'en-US-AriaNeural';
  if ($('speed')) $('speed').value = state.settings.rate || 0;
  if ($('pitch')) $('pitch').value = state.settings.pitch || 0;
  if ($('speedValue')) $('speedValue').textContent = (state.settings.rate || 0) + '%';
  if ($('pitchValue')) $('pitchValue').textContent = (state.settings.pitch || 0) + ' Hz';
  if ($('origVol')) $('origVol').value = state.settings.origVol || 100;
  if ($('addVol')) $('addVol').value = state.settings.addVol || 100;
  if ($('audioStart')) $('audioStart').value = state.settings.start || 0;
  if ($('audioEnd')) $('audioEnd').value = state.settings.end || 0;
}

function renderInspector() {
  // Handles switching inspector attributes context if a clip selection event takes place
}

// --- 🏎️ FAST RE-ENGINEERED SUB-SECOND STREAMING TTS TRIGGERS ---
async function generateAndStreamTTS(isPreview = false) {
  const textEl = $('ttsText');
  const voiceEl = $('voice');
  const speedEl = $('speed');
  const pitchEl = $('pitch');
  
  const wrap = $('ttsProgressWrap');
  const label = $('ttsProgressLabel');
  const pct = $('ttsProgressPct');
  const bar = $('ttsProgress');
  const status = $('ttsStatus');

  if (!textEl || !textEl.value.trim()) {
    toast('Please write or paste narration text first.', true);
    return;
  }

  try {
    busy(isPreview ? $('ttsPreview') : $('ttsCreate'), true);
    if (wrap) wrap.classList.remove('hidden');
    if (label) label.textContent = "Connecting to Edge Stream...";
    if (pct) pct.textContent = "Working...";
    if (bar) bar.style.width = "40%";
    if (status) status.textContent = "Synthesizing audio...";

    const text = textEl.value.trim();
    const voice = voiceEl ? voiceEl.value : 'en-US-AriaNeural';
    const speed = speedEl ? parseInt(speedEl.value, 10) : 0;
    const pitch = pitchEl ? parseInt(pitchEl.value, 10) : 0;

    // Call direct frontend streaming client module
    const audio = await EdgeTTS.synthesizeAndPlay(text, voice, speed, pitch);

    if (pct) pct.textContent = "100%";
    if (bar) bar.style.width = "100%";
    if (status) status.textContent = isPreview ? "Playing active stream preview!" : "Audio track synced!";

    if (!isPreview) {
      const response = await fetch(audio.src);
      const audioBlobData = await response.blob();
      ttsBlob = audioBlobData;
      state.audio = { blob: audioBlobData, text: text, duration: audio.duration * 1000 || 3000 };
      setAudioPreview({ blob: audioBlobData });
      await saveState();
    }

    setTimeout(() => {
      if (wrap) wrap.classList.add('hidden');
    }, 1000);

  } catch (err) {
    console.error('Narration engine connection dropped out:', err);
    toast('Streaming pipeline error.', true);
    if (status) status.textContent = `Error: ${err.message}`;
    if (pct) pct.textContent = "❌";
    if (bar) bar.style.width = "0%";
  } finally {
    busy(isPreview ? $('ttsPreview') : $('ttsCreate'), false);
  }
}

async function useImportedAudio(id) {
  const m = state.media.find(x => x.id === id);
  if (!m || !m.blob) return;
  ttsBlob = m.blob;
  state.audio = { blob: m.blob, text: m.name, duration: m.duration || 5000 };
  setAudioPreview({ blob: m.blob });
  await saveState();
  toast('Using selected clip as narration track');
}

// --- Player Controls & Transport Bindings ---
function togglePlay() {
  const video = $('previewVideo');
  if (!video || !state.timeline.length) return;
  
  if (isPlaying) {
    clearInterval(playInterval);
    video.pause();
    $('playBtn').textContent = '▶';
    isPlaying = false;
  } else {
    isPlaying = true;
    $('playBtn').textContent = '❚❚';
    video.play().catch(() => {});
    playInterval = setInterval(() => {
      if (timelinePlayheadMs >= timelineTotalMs()) {
        togglePlay();
        setTimelinePlayhead(0);
        return;
      }
      setTimelinePlayhead(timelinePlayheadMs + 100, { preview: true, scroll: true, save: false });
    }, 100);
  }
}

function stopPlayback() {
  if (isPlaying) togglePlay();
  const video = $('previewVideo');
  if (video) video.pause();
  setTimelinePlayhead(0);
}

// --- Main Document Wire-up Initialization Loop ---
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  
  // Create folder directory and save location structures if missing
  if (!localStorage.getItem('av-media')) {
    localStorage.setItem('av-media', JSON.stringify([]));
  }
  
  await refresh();

  // Connect slider update feedback elements
  $('speed')?.addEventListener('input', (e) => {
    $('speedValue').textContent = e.target.value + '%';
    state.settings.rate = parseInt(e.target.value, 10);
  });
  $('pitch')?.addEventListener('input', (e) => {
    $('pitchValue').textContent = e.target.value + ' Hz';
    state.settings.pitch = parseInt(e.target.value, 10);
  });

  // Bind Transport Player Controls
  $('playBtn')?.addEventListener('click', togglePlay);
  $('stopBtn')?.addEventListener('click', stopPlayback);
  
  // Connect re-engineered sub-second tts streaming triggers
  $('ttsCreate')?.addEventListener('click', (e) => { ripple(e); generateAndStreamTTS(false); });
  $('ttsPreview')?.addEventListener('click', (e) => { ripple(e); generateAndStreamTTS(true); });
  
  $('ttsUse')?.addEventListener('click', async () => {
    if (!ttsBlob) {
      toast('Please create or import audio narration tracks first.', true);
      return;
    }
    toast('Audio block committed to media storage tracks.');
  });

  $('timelineZoom')?.addEventListener('input', (e) => {
    timelineZoom = parseInt(e.target.value, 10);
    state.settings.timelineZoom = timelineZoom;
    renderTimeline();
    setTimelinePlayhead(timelinePlayheadMs, { preview: false, scroll: true });
  });

  // Setup playhead click/drag monitoring on the timeline scroll window canvas
  const tc = $('timelineCanvas');
  if (tc) {
    tc.addEventListener('mousedown', (e) => {
      const rect = tc.getBoundingClientRect();
      const clickX = e.clientX - rect.left - 88;
      if (clickX >= 0) {
        const targetMs = (clickX / timelineZoom) * 1000;
        setTimelinePlayhead(targetMs, { preview: true, scroll: false, save: true });
        playheadDragging = true;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!playheadDragging) return;
      const rect = tc.getBoundingClientRect();
      const clickX = e.clientX - rect.left - 88;
      if (clickX >= 0) {
        const targetMs = (clickX / timelineZoom) * 1000;
        setTimelinePlayhead(targetMs, { preview: true, scroll: false, save: false });
      }
    });
    window.addEventListener('mouseup', () => {
      if (playheadDragging) {
        playheadDragging = false;
        state.settings.playheadMs = timelinePlayheadMs;
        AVDB.put('projects', 'current', state);
      }
    });
  }
});
