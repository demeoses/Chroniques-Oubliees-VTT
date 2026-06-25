/* ══════════════════════════════════════════════════════════════════════════
   CHRONIQUES OUBLIÉES · VTT · script.js
   Version 2.0 — GitHub Pages compatible (static only)
   Phase 2 FINAL — Tokens, Sauvegarde unifiée, Nettoyage données
   ══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════════════════════════════════════════
//  ÉTAT GLOBAL
// ══════════════════════════════════════════════════════════════════════════
const State = {
  // Vue
  zoom: 1,
  minZoom: 0.2,
  maxZoom: 4,
  panX: 0,
  panY: 0,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  activeTool: 'select',

  // Grille
  gridVisible: false,
  gridCellSize: 60,
  gridColor: '#c9a84c',
  gridOpacity: 0.25,

  // Scènes
  currentSceneId: null,
  scenes: [],

  // Tokens Phase 2
  tokens: [],
  selectedTokenId: null,
  tokenDragging: false,
  tokenDragId: null,
  tokenDragOffX: 0,
  tokenDragOffY: 0,
  snapToGrid: true,

  // Brouillard Phase 2
  fogEnabled: false,
  fogOpacity: 0.85,
  fogPainting: false,
  fogTool: 'reveal',
  fogBrushSize: 2,

  // Combat / Initiative
  combatActive: false,
  currentTurn: 0,
  round: 0,
  initiativeOrder: [],

  // Paramètres
  campaignName: 'Ma Campagne',
  sessionNumber: 1,
  particlesEnabled: true,
  vignetteEnabled: true,

  // Particules splash
  particles: [],
  animFrame: null,

  // Phase 3 prep
  playerId: null,
  campaignId: null,
  playerRole: 'mj', // 'mj' ou 'joueur'
};

// ══════════════════════════════════════════════════════════════════════════
//  CONSTANTES UTILITAIRES
// ══════════════════════════════════════════════════════════════════════════
const STORAGE_KEY_MAIN = 'chroniques-vtt-data';

const HEROES = [
  { name: 'Thorin',      icon: '⚔',  class: 'warrior' },
  { name: 'Elara',       icon: '✦',  class: 'mage'    },
  { name: 'Zara',        icon: '🗡', class: 'rogue'   },
  { name: 'Brother Vex', icon: '☩',  class: 'cleric'  },
];

// ══════════════════════════════════════════════════════════════════════════
//  UTILITAIRES
// ══════════════════════════════════════════════════════════════════════════
function $(id) { return document.getElementById(id); }
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function showToast(message, type = 'info', icon = '⚜') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3200);
}

function updateLog(msg) {
  const el = $('log-last');
  if (el) el.textContent = msg;
}

// ══════════════════════════════════════════════════════════════════════════
//  SAUVEGARDE UNIFIÉE — TOUS LES SYSTÈMES
// ══════════════════════════════════════════════════════════════════════════
function saveToStorage() {
  try {
    // Sauvegarder images tokens séparément (trop volumineux)
    State.tokens.forEach(t => {
      if (t.imgData) {
        try {
          localStorage.setItem('co-tok-img-' + t.id, t.imgData);
        } catch (_) {}
      }
    });

    // Sauvegarder images cartes séparément
    State.scenes.forEach(s => {
      if (s.mapUrl && s.mapUrl.startsWith('data:')) {
        try {
          localStorage.setItem('co-map-img-' + s.id, s.mapUrl);
        } catch (_) {}
      }
    });

    // Sauvegarder brouillard par scène
    const canvas = $('fog-canvas');
    if (canvas && canvas.width) {
      try {
        const key = 'co-fog-map-' + (State.currentSceneId || 'default');
        localStorage.setItem(key, canvas.toDataURL('image/png'));
      } catch (_) {}
    }

    // Données principales (sans images)
    const data = {
      // Paramètres campagne
      campaignName: State.campaignName,
      sessionNumber: State.sessionNumber,
      gridVisible: State.gridVisible,
      gridCellSize: State.gridCellSize,
      gridColor: State.gridColor,
      gridOpacity: State.gridOpacity,
      particlesEnabled: State.particlesEnabled,
      vignetteEnabled: State.vignetteEnabled,
      currentSceneId: State.currentSceneId,

      // Scènes (sans données image)
      scenes: State.scenes.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        icon: s.icon,
        mapUrl: s.mapUrl && s.mapUrl.startsWith('data:') ? null : s.mapUrl,
        mapColor: s.mapColor,
        hasMapImg: !!(s.mapUrl && s.mapUrl.startsWith('data:')),
      })),

      // Tokens (sans images)
      tokens: State.tokens.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        hp: t.hp,
        hpMax: t.hpMax,
        size: t.size,
        color: t.color,
        icon: t.icon,
        x: t.x,
        y: t.y,
        hasImg: !!t.imgData,
      })),

      // Brouillard
      fogEnabled: State.fogEnabled,
      fogOpacity: State.fogOpacity,
      fogBrushSize: State.fogBrushSize,

      // Phase 3 prep
      playerId: State.playerId,
      campaignId: State.campaignId,
      playerRole: State.playerRole,
    };

    localStorage.setItem(STORAGE_KEY_MAIN, JSON.stringify(data));
  } catch (e) {
    console.warn('saveToStorage error:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MAIN);
    if (!raw) return false;
    const data = JSON.parse(raw);

    // Restaurer paramètres
    Object.assign(State, {
      campaignName: data.campaignName || 'Ma Campagne',
      sessionNumber: data.sessionNumber || 1,
      gridVisible: data.gridVisible || false,
      gridCellSize: data.gridCellSize || 60,
      gridColor: data.gridColor || '#c9a84c',
      gridOpacity: data.gridOpacity || 0.25,
      particlesEnabled: data.particlesEnabled !== undefined ? data.particlesEnabled : true,
      vignetteEnabled: data.vignetteEnabled !== undefined ? data.vignetteEnabled : true,
      currentSceneId: data.currentSceneId || null,
      fogEnabled: data.fogEnabled || false,
      fogOpacity: data.fogOpacity || 0.85,
      fogBrushSize: data.fogBrushSize || 2,
      playerId: data.playerId || null,
      campaignId: data.campaignId || null,
      playerRole: data.playerRole || 'mj',
    });

    // Restaurer scènes avec images
    if (data.scenes && data.scenes.length > 0) {
      State.scenes = data.scenes.map(s => {
        const scene = { ...s };
        if (s.hasMapImg) {
          const imgData = localStorage.getItem('co-map-img-' + s.id);
          if (imgData) scene.mapUrl = imgData;
        }
        return scene;
      });
    }

    // Restaurer tokens avec images
    if (data.tokens && data.tokens.length > 0) {
      State.tokens = data.tokens.map(t => {
        const token = { ...t };
        if (t.hasImg) {
          const imgData = localStorage.getItem('co-tok-img-' + t.id);
          if (imgData) token.imgData = imgData;
        }
        return token;
      });
    }

    return true;
  } catch (e) {
    console.warn('loadFromStorage error:', e);
    return false;
  }
}

function resetCampaignData() {
  // Supprimer TOUS les localStorage
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('chroniques-') || key.startsWith('co-')) {
      localStorage.removeItem(key);
    }
  });

  // Réinitialiser état
  State.scenes = [];
  State.tokens = [];
  State.selectedTokenId = null;
  State.currentSceneId = null;
  State.campaignName = 'Ma Campagne';
  State.sessionNumber = 1;
  State.fogEnabled = false;

  // Nettoyer DOM
  document.querySelectorAll('.vtt-token').forEach(e => e.remove());
  const tokensList = $('tokens-list-panel');
  if (tokensList) tokensList.innerHTML = '<span style="color:var(--text-muted);font-style:italic;font-size:0.8rem;">Aucun pion sur la carte.</span>';
  const scenesList = $('scenes-list');
  if (scenesList) scenesList.innerHTML = '';

  renderScenesList();
  renderScenesModal();
  updateCampaignDisplay();
  updateInfoDisplay();
  saveToStorage();
  showToast('Campagne réinitialisée', 'success', '♻');
  updateLog('Campagne réinitialisée');
}

// ══════════════════════════════════════════════════════════════════════════
//  PARTICULES — SPLASH SCREEN
// ══════════════════════════════════════════════════════════════════════════
function initSplashParticles() {
  const canvas = $('splash-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = ['rgba(201,168,76,', 'rgba(124,77,255,', 'rgba(179,157,255,'];

  for (let i = 0; i < 80; i++) {
    State.particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2 + 0.3,
      speedY: -(Math.random() * 0.6 + 0.1),
      speedX: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.6 + 0.1,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: Math.random(),
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    State.particles.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.life -= 0.003;
      if (p.life <= 0 || p.y < 0) {
        p.y = canvas.height + 5;
        p.x = Math.random() * canvas.width;
        p.life = Math.random();
        p.opacity = Math.random() * 0.6 + 0.1;
      }
      const alpha = p.opacity * Math.min(p.life * 3, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + alpha + ')';
      ctx.fill();
    });
    State.animFrame = requestAnimationFrame(animate);
  }
  animate();
}

// ══════════════════════════════════════════════════════════════════════════
//  TRANSITION SPLASH → APP
// ══════════════════════════════════════════════════════════════════════════
function enterApp() {
  const splash = $('splash-screen');
  const app = $('app');

  splash.classList.add('fade-out');
  setTimeout(() => {
    splash.remove();
    cancelAnimationFrame(State.animFrame);
    app.classList.remove('hidden');
    initApp();
  }, 850);
}

// ══════════════════════════════════════════════════════════════════════════
//  INITIALISATION PRINCIPALE
// ══════════════════════════════════════════════════════════════════════════
function initApp() {
  loadFromStorage();
  applySavedSettings();

  renderScenesList();
  renderScenesModal();
  setupMapViewport();
  setupToolbar();
  setupTopbar();
  setupDice();
  setupInitiative();
  setupModals();
  setupSettings();
  setupFileImports();
  setupKeyboard();
  setupMinimap();

  // Phase 2 — Tokens & Brouillard
  initPhase2();

  // Charger la première scène si elle existe
  if (State.scenes.length && State.currentSceneId) {
    const scene = State.scenes.find(s => s.id === State.currentSceneId);
    if (scene) loadScene(scene);
  } else if (State.scenes.length) {
    loadScene(State.scenes[0]);
  }

  applyVignette();
  updateCampaignDisplay();
  updateInfoDisplay();

  updateLog('Bienvenue, Maître du Jeu…');
  showToast('Table virtuelle prête', 'success', '⚜');
}

function applySavedSettings() {
  // Grille
  const gridBtn = $('btn-grid-toggle');
  if (State.gridVisible && gridBtn) gridBtn.classList.add('active');

  // Paramètres UI
  const settCamp = $('setting-campaign-name');
  if (settCamp) settCamp.value = State.campaignName;
  const settSess = $('setting-session');
  if (settSess) settSess.value = State.sessionNumber;
  const settGrid = $('setting-grid');
  if (settGrid) settGrid.checked = State.gridVisible;
  const settCell = $('setting-cell-size');
  if (settCell) settCell.value = State.gridCellSize;
  const settColor = $('setting-grid-color');
  if (settColor) settColor.value = State.gridColor;
  const settOp = $('setting-grid-opacity');
  if (settOp) settOp.value = State.gridOpacity;
  const settPart = $('setting-particles');
  if (settPart) settPart.checked = State.particlesEnabled;
  const settVign = $('setting-vignette');
  if (settVign) settVign.checked = State.vignetteEnabled;
}

function updateCampaignDisplay() {
  const nameEl = $('campaign-name');
  if (nameEl) nameEl.textContent = State.campaignName;
  const sessEl = $('info-session');
  if (sessEl) sessEl.textContent = `#${State.sessionNumber}`;
}

function updateInfoDisplay() {
  const tokensEl = $('info-tokens');
  if (tokensEl) tokensEl.textContent = State.tokens.length;
  const scenesEl = $('info-scenes');
  if (scenesEl) scenesEl.textContent = State.scenes.length;
}

// ══════════════════════════════════════════════════════════════════════════
//  SCÈNES
// ══════════════════════════════════════════════════════════════════════════
function renderScenesList() {
  const list = $('scenes-list');
  if (!list) return;
  list.innerHTML = '';
  if (State.scenes.length === 0) {
    list.innerHTML = '<span style="color:var(--text-muted);font-style:italic;font-size:0.8rem;">Aucune scène. Importez une carte.</span>';
    return;
  }
  State.scenes.forEach(scene => {
    const item = document.createElement('div');
    item.className = 'scene-item' + (scene.id === State.currentSceneId ? ' active' : '');
    item.innerHTML = `
      <span class="scene-item-icon">${scene.icon}</span>
      <div class="scene-item-info">
        <span class="scene-item-name">${scene.name}</span>
        <span class="scene-item-desc">${scene.description}</span>
      </div>
    `;
    item.addEventListener('click', () => {
      loadScene(scene);
      closeAllModals();
    });
    list.appendChild(item);
  });
}

function renderScenesModal() {
  const grid = $('modal-scenes-grid');
  if (!grid) return;
  grid.innerHTML = '';
  State.scenes.forEach(scene => {
    const card = document.createElement('div');
    card.className = 'modal-scene-card' + (scene.id === State.currentSceneId ? ' active' : '');
    const previewContent = scene.mapUrl
      ? `<img src="${scene.mapUrl}" alt="${scene.name}" />`
      : `<span style="font-size:2.5rem">${scene.icon}</span>`;
    card.innerHTML = `
      <div class="modal-scene-preview" style="${scene.mapUrl ? '' : 'background:' + scene.mapColor}">
        ${previewContent}
      </div>
      <div class="modal-scene-info">
        <span class="modal-scene-name">${scene.name}</span>
        <span class="modal-scene-desc">${scene.description}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      loadScene(scene);
      closeAllModals();
    });
    grid.appendChild(card);
  });
}

function loadScene(scene) {
  State.currentSceneId = scene.id;
  const mapImg = $('map-image');
  const placeholder = $('map-placeholder');
  const loading = $('map-loading');
  const sceneLabel = $('current-scene-label');

  if (sceneLabel) sceneLabel.textContent = scene.name;

  if (scene.mapUrl) {
    placeholder.classList.add('hidden');
    loading.classList.remove('hidden');

    mapImg.onload = () => {
      loading.classList.add('hidden');
      mapImg.style.display = 'block';
      fitView();
      drawGrid();
      updateMinimap();
      ensureFogCanvas();
      setTimeout(() => {
        resizeFogCanvas();
        applyFogOpacity();
        restoreFogCanvas();
      }, 50);
    };
    mapImg.onerror = () => {
      loading.classList.add('hidden');
      placeholder.classList.remove('hidden');
      showToast('Impossible de charger la carte', 'warning', '⚠');
    };
    mapImg.src = scene.mapUrl;
  } else {
    mapImg.src = '';
    mapImg.style.display = 'none';
    placeholder.classList.remove('hidden');
    loading.classList.add('hidden');

    const container = $('map-container');
    if (container) container.style.background = scene.mapColor || 'var(--deep)';
  }

  renderScenesList();
  renderScenesModal();
  saveToStorage();
  updateLog(`Scène chargée : ${scene.name}`);
  showToast(`${scene.icon} ${scene.name}`, 'info');
}

// ══════════════════════════════════════════════════════════════════════════
//  MAP VIEWPORT — ZOOM & PAN
// ══════════════════════════════════════════════════════════════════════════
function setupMapViewport() {
  const viewport = $('map-viewport');
  const container = $('map-container');
  if (!viewport || !container) return;

  // Molette — zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = clamp(State.zoom + delta * State.zoom, State.minZoom, State.maxZoom);
    const ratio = newZoom / State.zoom;

    State.panX = mouseX - ratio * (mouseX - State.panX);
    State.panY = mouseY - ratio * (mouseY - State.panY);
    State.zoom = newZoom;

    applyTransform();
    updateZoomLabel();
    updateMinimap();
  }, { passive: false });

  // Clic milieu ou outil pan — déplacement
  viewport.addEventListener('mousedown', (e) => {
    if (e.button === 1 || State.activeTool === 'pan') {
      e.preventDefault();
      State.isPanning = true;
      State.panStartX = e.clientX - State.panX;
      State.panStartY = e.clientY - State.panY;
      viewport.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!State.isPanning) {
      const viewport = $('map-viewport');
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        const worldX = Math.round((e.clientX - rect.left - State.panX) / State.zoom);
        const worldY = Math.round((e.clientY - rect.top - State.panY) / State.zoom);
        const coordsEl = $('coords-text');
        if (coordsEl) coordsEl.textContent = `${worldX}, ${worldY}`;
      }
      return;
    }
    State.panX = e.clientX - State.panStartX;
    State.panY = e.clientY - State.panStartY;
    applyTransform();
    updateMinimap();
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1 || State.activeTool === 'pan') {
      State.isPanning = false;
      const viewport = $('map-viewport');
      if (viewport) viewport.style.cursor = State.activeTool === 'pan' ? 'grab' : 'default';
    }
  });

  // Touch support (mobile)
  let lastTouchDist = null;
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    } else if (e.touches.length === 1) {
      State.isPanning = true;
      State.panStartX = e.touches[0].clientX - State.panX;
      State.panStartY = e.touches[0].clientY - State.panY;
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && lastTouchDist !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / lastTouchDist;
      State.zoom = clamp(State.zoom * ratio, State.minZoom, State.maxZoom);
      lastTouchDist = dist;
      applyTransform();
      updateZoomLabel();
    } else if (e.touches.length === 1 && State.isPanning) {
      State.panX = e.touches[0].clientX - State.panStartX;
      State.panY = e.touches[0].clientY - State.panStartY;
      applyTransform();
    }
  }, { passive: true });

  viewport.addEventListener('touchend', () => {
    State.isPanning = false;
    lastTouchDist = null;
  });
}

function applyTransform() {
  const container = $('map-container');
  if (container) {
    container.style.transform = `translate(${State.panX}px, ${State.panY}px) scale(${State.zoom})`;
    container.style.transformOrigin = '0 0';
  }
  drawGrid();
}

function updateZoomLabel() {
  const lbl = $('zoom-label');
  if (lbl) lbl.textContent = Math.round(State.zoom * 100) + '%';
}

function fitView() {
  const viewport = $('map-viewport');
  const mapImg = $('map-image');
  if (!viewport || !mapImg || !mapImg.naturalWidth) return;

  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const iw = mapImg.naturalWidth;
  const ih = mapImg.naturalHeight;

  const scaleX = vw / iw;
  const scaleY = vh / ih;
  State.zoom = clamp(Math.min(scaleX, scaleY) * 0.95, State.minZoom, State.maxZoom);
  State.panX = (vw - iw * State.zoom) / 2;
  State.panY = (vh - ih * State.zoom) / 2;

  applyTransform();
  updateZoomLabel();
}

// ══════════════════════════════════════════════════════════════════════════
//  GRILLE
// ══════════════════════════════════════════════════════════════════════════
function drawGrid() {
  const canvas = $('grid-canvas');
  if (!canvas) return;
  const viewport = $('map-viewport');
  canvas.width = viewport.clientWidth;
  canvas.height = viewport.clientHeight;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!State.gridVisible) return;

  const cellSize = State.gridCellSize * State.zoom;
  const offsetX = State.panX % cellSize;
  const offsetY = State.panY % cellSize;

  ctx.strokeStyle = State.gridColor;
  ctx.globalAlpha = State.gridOpacity;
  ctx.lineWidth = 0.8;

  ctx.beginPath();
  for (let x = offsetX; x < canvas.width; x += cellSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = offsetY; y < canvas.height; y += cellSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function toggleGrid() {
  State.gridVisible = !State.gridVisible;
  const btn = $('btn-grid-toggle');
  if (btn) btn.classList.toggle('active', State.gridVisible);

  const settGrid = $('setting-grid');
  if (settGrid) settGrid.checked = State.gridVisible;

  drawGrid();
  saveToStorage();
  showToast(State.gridVisible ? 'Grille activée' : 'Grille masquée', 'info', '⊞');
}

// ══════════════════════════════════════════════════════════════════════════
//  MINIMAP
// ══════════════════════════════════════════════════════════════════════════
function setupMinimap() {
  const minimap = $('minimap-canvas');
  if (!minimap) return;
  minimap.addEventListener('click', (e) => {
    const rect = minimap.getBoundingClientRect();
    const mapImg = $('map-image');
    if (!mapImg || !mapImg.naturalWidth) return;

    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const viewport = $('map-viewport');

    State.panX = -(rx * mapImg.naturalWidth * State.zoom) + viewport.clientWidth / 2;
    State.panY = -(ry * mapImg.naturalHeight * State.zoom) + viewport.clientHeight / 2;
    applyTransform();
    updateMinimap();
  });
}

function updateMinimap() {
  const canvas = $('minimap-canvas');
  const indicator = $('minimap-viewport-indicator');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const mapImg = $('map-image');
  const viewport = $('map-viewport');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!mapImg || !mapImg.naturalWidth) {
    if (indicator) indicator.style.display = 'none';
    return;
  }

  ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);

  if (!indicator || !viewport) return;
  const scaleX = canvas.width / mapImg.naturalWidth;
  const scaleY = canvas.height / mapImg.naturalHeight;

  const visW = (viewport.clientWidth / State.zoom) * scaleX;
  const visH = (viewport.clientHeight / State.zoom) * scaleY;
  const visX = (-State.panX / State.zoom) * scaleX;
  const visY = (-State.panY / State.zoom) * scaleY;

  indicator.style.display = 'block';
  indicator.style.left   = clamp(visX, 0, canvas.width) + 'px';
  indicator.style.top    = clamp(visY, 0, canvas.height) + 'px';
  indicator.style.width  = Math.min(visW, canvas.width) + 'px';
  indicator.style.height = Math.min(visH, canvas.height) + 'px';
}

// ══════════════════════════════════════════════════════════════════════════
//  TOOLBAR GAUCHE
// ══════════════════════════════════════════════════════════════════════════
function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      State.activeTool = btn.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const viewport = $('map-viewport');
      if (viewport) {
        viewport.style.cursor = State.activeTool === 'pan' ? 'grab' : 'default';
      }
      updateLog(`Outil : ${btn.querySelector('span')?.textContent || btn.dataset.tool}`);
    });
  });

  $('btn-zoom-in')?.addEventListener('click', () => {
    State.zoom = clamp(State.zoom * 1.2, State.minZoom, State.maxZoom);
    applyTransform();
    updateZoomLabel();
    updateMinimap();
  });

  $('btn-zoom-out')?.addEventListener('click', () => {
    State.zoom = clamp(State.zoom / 1.2, State.minZoom, State.maxZoom);
    applyTransform();
    updateZoomLabel();
    updateMinimap();
  });

  $('btn-fit-view')?.addEventListener('click', () => {
    fitView();
    updateMinimap();
    showToast('Vue ajustée', 'info', '⊞');
  });

  $('btn-ambient')?.addEventListener('click', () => {
    showToast("Sons d'ambiance (Phase 3)", 'warning', '🎵');
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  TOPBAR
// ══════════════════════════════════════════════════════════════════════════
function setupTopbar() {
  $('btn-grid-toggle')?.addEventListener('click', toggleGrid);

  $('btn-scene-switcher')?.addEventListener('click', () => openModal('modal-scene'));

  $('btn-settings')?.addEventListener('click', () => openModal('modal-settings'));

  $('campaign-name')?.addEventListener('click', () => openModal('modal-settings'));

  document.querySelector('#scenes-list')?.closest('.panel-section')
    ?.querySelector('.btn-add')
    ?.addEventListener('click', () => {
      $('file-map-import')?.click();
    });
}

// ══════════════════════════════════════════════════════════════════════════
//  MODALES
// ══════════════════════════════════════════════════════════════════════════
function openModal(id) {
  const modal = $(id);
  if (modal) modal.classList.remove('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function setupModals() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', closeAllModals);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  PARAMÈTRES
// ══════════════════════════════════════════════════════════════════════════
function setupSettings() {
  $('btn-save-settings')?.addEventListener('click', () => {
    const campName = $('setting-campaign-name')?.value.trim();
    if (campName) State.campaignName = campName;

    const sess = parseInt($('setting-session')?.value, 10);
    if (!isNaN(sess) && sess > 0) State.sessionNumber = sess;

    State.gridVisible  = $('setting-grid')?.checked || false;
    State.gridCellSize = parseInt($('setting-cell-size')?.value, 10) || 60;
    State.gridColor    = $('setting-grid-color')?.value || '#c9a84c';
    State.gridOpacity  = parseFloat($('setting-grid-opacity')?.value) || 0.25;
    State.particlesEnabled = $('setting-particles')?.checked !== false;
    State.vignetteEnabled  = $('setting-vignette')?.checked !== false;

    const gridBtn = $('btn-grid-toggle');
    if (gridBtn) gridBtn.classList.toggle('active', State.gridVisible);

    drawGrid();
    applyVignette();
    updateCampaignDisplay();
    saveToStorage();
    closeAllModals();
    showToast('Paramètres sauvegardés', 'success', '✓');
    updateLog('Paramètres mis à jour');
  });

  $('setting-grid-opacity')?.addEventListener('input', (e) => {
    State.gridOpacity = parseFloat(e.target.value);
    if (State.gridVisible) drawGrid();
  });
  $('setting-grid-color')?.addEventListener('input', (e) => {
    State.gridColor = e.target.value;
    if (State.gridVisible) drawGrid();
  });
  $('setting-cell-size')?.addEventListener('input', (e) => {
    State.gridCellSize = parseInt(e.target.value, 10) || 60;
    if (State.gridVisible) drawGrid();
  });
  $('setting-grid')?.addEventListener('change', (e) => {
    State.gridVisible = e.target.checked;
    const gridBtn = $('btn-grid-toggle');
    if (gridBtn) gridBtn.classList.toggle('active', State.gridVisible);
    drawGrid();
  });

  // Bouton réinitialiser campagne
  const btnReset = document.querySelector('#modal-settings .settings-group');
  if (btnReset && !$('btn-reset-campaign')) {
    const resetBtn = document.createElement('button');
    resetBtn.id = 'btn-reset-campaign';
    resetBtn.className = 'btn-fantasy';
    resetBtn.style.marginTop = '12px';
    resetBtn.style.background = 'rgba(192,57,43,0.15)';
    resetBtn.style.borderColor = 'var(--blood)';
    resetBtn.textContent = '♻ Réinitialiser la campagne';
    resetBtn.addEventListener('click', () => {
      if (confirm('Êtes-vous sûr ? Cette action supprimera TOUTES les données sauvegardées.')) {
        resetCampaignData();
        closeAllModals();
      }
    });
    btnReset.parentElement.appendChild(resetBtn);
  }
}

function applyVignette() {
  const viewport = $('map-viewport');
  if (!viewport) return;
  if (State.vignetteEnabled) {
    viewport.style.boxShadow = 'inset 0 0 80px rgba(7,7,14,0.6)';
  } else {
    viewport.style.boxShadow = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  IMPORT DE CARTES
// ══════════════════════════════════════════════════════════════════════════
function setupFileImports() {
  $('btn-import-map')?.addEventListener('click', () => $('file-map-import')?.click());

  $('file-map-import')?.addEventListener('change', (e) => {
    handleMapFile(e.target.files[0]);
  });

  $('btn-modal-import')?.addEventListener('click', () => $('file-modal-import')?.click());

  $('file-modal-import')?.addEventListener('change', (e) => {
    handleMapFile(e.target.files[0]);
    closeAllModals();
  });

  const viewport = $('map-viewport');
  if (viewport) {
    viewport.addEventListener('dragover', (e) => {
      e.preventDefault();
      viewport.style.outline = '2px dashed var(--gold)';
    });
    viewport.addEventListener('dragleave', () => {
      viewport.style.outline = '';
    });
    viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      viewport.style.outline = '';
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) handleMapFile(file);
    });
  }

  const panelAddBtn = document.querySelector('#panel-right .btn-add');
  if (panelAddBtn) {
    panelAddBtn.addEventListener('click', () => $('file-map-import')?.click());
  }
}

function handleMapFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Format invalide (PNG/JPG uniquement)', 'warning', '⚠');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Fichier trop lourd (max 10 Mo)', 'warning', '⚠');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const sceneName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

    const newId = 'scene-custom-' + Date.now();
    const newScene = {
      id: newId,
      name: sceneName,
      description: 'Carte importée localement',
      icon: '🗺',
      mapUrl: dataUrl,
      mapColor: 'linear-gradient(135deg, #0a0a1a, #1a1a2e)',
    };

    State.scenes.push(newScene);
    loadScene(newScene);
    renderScenesList();
    renderScenesModal();
    saveToStorage();
    updateInfoDisplay();
    showToast(`Carte importée : ${sceneName}`, 'success', '📜');
    updateLog(`Carte importée : ${sceneName}`);
  };
  reader.readAsDataURL(file);
}

// ═════════════════════════════════════════════════════════════════════════
//  DÉS
// ═════════════════════════════════════════════════════════════════════════
function setupDice() {
  document.querySelectorAll('.dice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sides = parseInt(btn.dataset.sides, 10);
      rollDie(sides);
    });
  });
}

function rollDie(sides) {
  const result = Math.floor(Math.random() * sides) + 1;
  const resultEl = $('dice-result');
  const valueEl  = $('dice-result-value');
  const typeEl   = $('dice-result-type');

  if (resultEl) resultEl.classList.remove('hidden');
  if (valueEl)  valueEl.textContent = result;
  if (typeEl)   typeEl.textContent  = `d${sides}`;

  if (valueEl) {
    valueEl.style.transform = 'scale(1.4)';
    valueEl.style.color = result === sides ? 'var(--gold-light)' : result === 1 ? 'var(--blood)' : 'var(--text-primary)';
    setTimeout(() => {
      valueEl.style.transform = 'scale(1)';
    }, 200);
  }

  const msg = `d${sides} → ${result}${result === sides ? ' 🎉 CRITIQUE !' : result === 1 ? ' 💀 FUMBLE' : ''}`;
  updateLog(msg);

  const icon = result === sides ? '🎉' : result === 1 ? '💀' : '🎲';
  const type = result === sides ? 'success' : result === 1 ? 'warning' : 'info';
  showToast(msg, type, icon);
}

// ═════════════════════════════════════════════════════════════════════════
//  INITIATIVE
// ═════════════════════════════════════════════════════════════════════════
function setupInitiative() {
  $('btn-roll-initiative')?.addEventListener('click', rollInitiative);
  $('btn-end-turn')?.addEventListener('click', nextTurn);
  $('btn-next-round')?.addEventListener('click', nextRound);
}

function rollInitiative() {
  if (State.combatActive) {
    State.combatActive = false;
    State.round = 0;
    State.currentTurn = 0;
    State.initiativeOrder = [];
    renderInitiativeTrack();
    $('round-number').textContent = '—';
    $('info-round').textContent = '—';
    showToast('Combat terminé', 'info', '⚔');
    updateLog('Combat terminé');
    return;
  }

  const combatants = [
    ...HEROES.map(h => ({
      name: h.name,
      icon: h.icon,
      initiative: Math.floor(Math.random() * 20) + 1,
      isEnemy: false,
    })),
    {
      name: 'Ennemi',
      icon: '💀',
      initiative: Math.floor(Math.random() * 20) + 1,
      isEnemy: true,
    },
  ];

  combatants.sort((a, b) => b.initiative - a.initiative);

  State.initiativeOrder = combatants;
  State.currentTurn = 0;
  State.round = 1;
  State.combatActive = true;

  renderInitiativeTrack();
  $('round-number').textContent = State.round;
  $('info-round').textContent = State.round;
  $('btn-roll-initiative').innerHTML = '<span>🛑</span><small>Arrêter</small>';

  showToast('Combat lancé !', 'success', '⚔');
  updateLog(`Combat — Round ${State.round} — Tour de ${State.initiativeOrder[0].name}`);
}

function nextTurn() {
  if (!State.combatActive) return;
  State.currentTurn = (State.currentTurn + 1) % State.initiativeOrder.length;
  if (State.currentTurn === 0) nextRound();
  else renderInitiativeTrack();
  const current = State.initiativeOrder[State.currentTurn];
  updateLog(`Tour de ${current.name} (initiative ${current.initiative})`);
}

function nextRound() {
  if (!State.combatActive) return;
  State.round++;
  State.currentTurn = 0;
  $('round-number').textContent = State.round;
  $('info-round').textContent = State.round;
  renderInitiativeTrack();
  showToast(`Round ${State.round}`, 'info', '🔄');
  updateLog(`Round ${State.round} — Tour de ${State.initiativeOrder[0].name}`);
}

function renderInitiativeTrack() {
  const track = $('init-track');
  if (!track) return;
  track.innerHTML = '';

  if (!State.combatActive || !State.initiativeOrder.length) {
    track.innerHTML = '<span class="init-empty">— Combat non lancé —</span>';
    return;
  }

  State.initiativeOrder.forEach((c, i) => {
    const slot = document.createElement('div');
    slot.className = 'init-slot' + (i === State.currentTurn ? ' active' : '') + (c.isEnemy ? ' enemy' : '');
    slot.innerHTML = `
      <span class="init-icon">${c.icon}</span>
      <span class="init-name">${c.name}</span>
      <span class="init-score">${c.initiative}</span>
    `;
    slot.title = `${c.name} — Initiative : ${c.initiative}`;
    slot.addEventListener('click', () => {
      State.currentTurn = i;
      renderInitiativeTrack();
    });
    track.appendChild(slot);
  });
}

// ═════════════════════════════════════════════════════════════════════════
//  RACCOURCIS CLAVIER
// ═════════════════════════════════════════════════════════════════════════
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    switch (e.key.toLowerCase()) {
      case 's': activateTool('select'); break;
      case 'g': activateTool('pan'); break;
      case 'm': activateTool('measure'); break;
      case 'f': fitView(); updateMinimap(); break;
      case '+': case '=':
        State.zoom = clamp(State.zoom * 1.2, State.minZoom, State.maxZoom);
        applyTransform(); updateZoomLabel(); updateMinimap();
        break;
      case '-':
        State.zoom = clamp(State.zoom / 1.2, State.minZoom, State.maxZoom);
        applyTransform(); updateZoomLabel(); updateMinimap();
        break;
      case 'escape': closeAllModals(); break;
      case 't': openTokenCreateModal(); break;
    }
  });
}

function activateTool(tool) {
  State.activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  const viewport = $('map-viewport');
  if (viewport) viewport.style.cursor = tool === 'pan' ? 'grab' : 'default';
}

window.addEventListener('resize', () => {
  drawGrid();
  updateMinimap();
});

// ═════════════════════════════════════════════════════════════════════════
//  PHASE 2 — TOKENS
// ═════════════════════════════════════════════════════════════════════════
let _pendingImgData = null;

function initPhase2() {
  // Brush cursor
  if (!$('fog-brush-cursor')) {
    const cur = document.createElement('div');
    cur.id = 'fog-brush-cursor';
    document.body.appendChild(cur);
  }

  // Token info panel
  if (!$('token-info-panel')) {
    const panel = document.createElement('div');
    panel.id = 'token-info-panel';
    panel.innerHTML = `
      <div class="tip-name" id="tip-name">—</div>
      <div class="tip-type" id="tip-type">—</div>
      <div class="tip-hp-row">
        <div class="tip-hp-bar"><div class="tip-hp-fill" id="tip-hp-fill"></div></div>
        <span class="tip-hp-text" id="tip-hp-text">—</span>
      </div>
      <div class="tip-actions">
        <button class="tip-btn" id="tip-btn-damage">— PV</button>
        <button class="tip-btn" id="tip-btn-heal">+ PV</button>
        <button class="tip-btn" id="tip-btn-edit">✎</button>
        <button class="tip-btn danger" id="tip-btn-delete">✕</button>
      </div>`;
    document.body.appendChild(panel);
    $('tip-btn-damage')?.addEventListener('click', () => adjustHP(State.selectedTokenId, -1));
    $('tip-btn-heal')?.addEventListener('click',   () => adjustHP(State.selectedTokenId, +1));
    $('tip-btn-edit')?.addEventListener('click',   () => openTokenEditModal(State.selectedTokenId));
    $('tip-btn-delete')?.addEventListener('click', () => { deleteToken(State.selectedTokenId); });
  }

  // Brouillard
  ensureFogCanvas();
  applyFogVisibility();
  restoreFogCanvas();

  // Render tokens sauvegardés
  State.tokens.forEach(t => renderToken(t));

  // Wire modal buttons
  $('btn-new-token-from-panel')?.addEventListener('click', () => { closeAllModals(); openTokenCreateModal(); });
  $('btn-token-img-pick')?.addEventListener('click', () => $('token-img-file')?.click());
  $('token-img-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      _pendingImgData = ev.target.result;
      const nm = $('token-img-name'); if (nm) nm.textContent = file.name;
      const prev = $('token-img-preview'); if (prev) prev.style.display = 'block';
      const prevImg = $('token-img-preview-img'); if (prevImg) prevImg.src = _pendingImgData;
    };
    reader.readAsDataURL(file);
  });
  $('btn-token-save')?.addEventListener('click', saveTokenFromModal);
  $('btn-token-cancel')?.addEventListener('click', closeAllModals);

  // Fog modal
  $('fog-enabled')?.addEventListener('change', (e) => {
    State.fogEnabled = e.target.checked;
    applyFogVisibility();
    saveToStorage();
    showToast(State.fogEnabled ? 'Brouillard activé' : 'Brouillard désactivé', 'info', '🌫');
  });
  $('fog-opacity')?.addEventListener('input', (e) => {
    State.fogOpacity = parseFloat(e.target.value);
    applyFogOpacity();
  });
  $('fog-brush-size')?.addEventListener('change', (e) => { State.fogBrushSize = parseInt(e.target.value, 10) || 2; });
  document.querySelectorAll('.fog-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      State.fogTool = btn.dataset.fogTool;
      document.querySelectorAll('.fog-tool-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  $('btn-fog-reveal-all')?.addEventListener('click', fogRevealAll);
  $('btn-fog-hide-all')?.addEventListener('click', fogHideAll);

  // Topbar buttons
  $('btn-tokens-panel')?.addEventListener('click', () => {
    renderTokensListPanel();
    openModal('modal-tokens-panel');
  });
  $('btn-fog-panel')?.addEventListener('click', () => {
    const fChk = $('fog-enabled'); if (fChk) fChk.checked = State.fogEnabled;
    const fOp  = $('fog-opacity');  if (fOp)  fOp.value  = State.fogOpacity;
    const fBr  = $('fog-brush-size'); if (fBr) fBr.value = State.fogBrushSize;
    openModal('modal-fog');
  });

  // Search tokens
  const searchInput = $('token-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.token-list-row').forEach(row => {
        const name = row.querySelector('.token-list-name')?.textContent.toLowerCase() || '';
        row.style.display = name.includes(query) ? 'flex' : 'none';
      });
    });
  }

  setupFogPainting();
  setupTokenDrag();

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && State.selectedTokenId) {
      deleteToken(State.selectedTokenId);
    }
  });

  // Click viewport background → deselect (NOT on token)
  $('map-viewport')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.vtt-token') && !State.fogPainting && e.button === 0) {
      selectToken(null);
    }
  });
}

function generateTokenId() { return 'tok-' + Date.now() + '-' + Math.floor(Math.random() * 9999); }

function openTokenCreateModal() {
  _pendingImgData = null;
  $('token-edit-id').value = '';
  $('modal-token-title').textContent = '♟ Créer un Pion';
  $('token-name').value = '';
  $('token-type').value = 'joueur';
  $('token-hp').value = '30';
  $('token-hp-max').value = '30';
  $('token-size').value = '1';
  $('token-color').value = '#c9a84c';
  $('token-icon').value = '';
  const nm = $('token-img-name'); if (nm) nm.textContent = 'aucune';
  const prev = $('token-img-preview'); if (prev) prev.style.display = 'none';
  const fi = $('token-img-file'); if (fi) fi.value = '';
  openModal('modal-token-create');
  setTimeout(() => $('token-name')?.focus(), 100);
}

function openTokenEditModal(id) {
  const t = State.tokens.find(t => t.id === id);
  if (!t) return;
  _pendingImgData = t.imgData || null;
  $('token-edit-id').value = id;
  $('modal-token-title').textContent = '✎ Modifier le Pion';
  $('token-name').value = t.name;
  $('token-type').value = t.type;
  $('token-hp').value = t.hp;
  $('token-hp-max').value = t.hpMax;
  $('token-size').value = t.size;
  $('token-color').value = t.color;
  $('token-icon').value = t.icon || '';
  const nm = $('token-img-name'); if (nm) nm.textContent = t.imgData ? 'image chargée' : 'aucune';
  const prev = $('token-img-preview'); if (prev) prev.style.display = t.imgData ? 'block' : 'none';
  const prevImg = $('token-img-preview-img'); if (prevImg && t.imgData) prevImg.src = t.imgData;
  closeAllModals();
  openModal('modal-token-create');
}

function saveTokenFromModal() {
  const name = ($('token-name')?.value || '').trim();
  if (!name) { showToast('Donnez un nom au pion', 'warning', '⚠'); return; }
  const editId = $('token-edit-id')?.value;
  const hp    = parseInt($('token-hp')?.value, 10)    || 30;
  const hpMax = parseInt($('token-hp-max')?.value, 10) || 30;
  const size  = parseInt($('token-size')?.value, 10)   || 1;

  if (editId) {
    const t = State.tokens.find(t => t.id === editId);
    if (t) {
      t.name  = name;
      t.type  = $('token-type')?.value || 'joueur';
      t.hp    = hp;
      t.hpMax = hpMax;
      t.size  = size;
      t.color = $('token-color')?.value || '#c9a84c';
      t.icon  = $('token-icon')?.value || '';
      if (_pendingImgData) t.imgData = _pendingImgData;
      const el = $('token-el-' + editId);
      if (el) { el.remove(); }
      renderToken(t);
      selectToken(t.id);
    }
  } else {
    const vp = $('map-viewport');
    const cx = vp ? (vp.clientWidth  / 2 - State.panX) / State.zoom : 200;
    const cy = vp ? (vp.clientHeight / 2 - State.panY) / State.zoom : 200;
    const token = {
      id:     generateTokenId(),
      name,
      type:   $('token-type')?.value || 'joueur',
      hp,
      hpMax,
      size,
      color:  $('token-color')?.value || '#c9a84c',
      icon:   $('token-icon')?.value || '',
      imgData: _pendingImgData || null,
      x: cx,
      y: cy,
    };
    State.tokens.push(token);
    renderToken(token);
    selectToken(token.id);
    updateInfoDisplay();
    showToast(`♟ ${name} placé sur la carte`, 'success', '♟');
    updateLog(`Pion créé : ${name}`);
  }
  saveToStorage();
  closeAllModals();
}

function renderToken(t) {
  const layer = $('tokens-layer');
  if (!layer) return;
  const cellPx = State.gridCellSize;
  const sizePx = cellPx * t.size;
  const el = document.createElement('div');
  el.id = 'token-el-' + t.id;
  el.className = 'vtt-token ' + t.type;
  el.style.cssText = `
    width: ${sizePx}px;
    height: ${sizePx}px;
    left: ${t.x - sizePx / 2}px;
    top:  ${t.y - sizePx / 2}px;
    border-color: ${t.color};
  `;
  el.dataset.tokenId = t.id;

  const inner = document.createElement('div');
  inner.className = 'token-inner';
  if (t.imgData) {
    const img = document.createElement('img');
    img.src = t.imgData;
    img.draggable = false;
    inner.appendChild(img);
  } else {
    const icon = t.icon || defaultIcon(t.type);
    inner.textContent = icon;
  }
  el.appendChild(inner);

  const label = document.createElement('div');
  label.className = 'token-label';
  label.textContent = t.name;
  el.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'token-hp-bar';
  const fill = document.createElement('div');
  fill.className = 'token-hp-fill';
  fill.id = 'hp-fill-' + t.id;
  updateHpFill(fill, t.hp, t.hpMax);
  bar.appendChild(fill);
  el.appendChild(bar);

  el.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (e.button === 0) selectToken(t.id);
  });

  layer.appendChild(el);
  if (State.selectedTokenId === t.id) el.classList.add('selected');
}

function defaultIcon(type) {
  return type === 'joueur' ? '🧙' : type === 'ennemi' ? '💀' : '🗣';
}

function updateHpFill(fillEl, hp, hpMax) {
  const pct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  fillEl.style.width = pct + '%';
  fillEl.style.background = pct > 60 ? '#27ae60' : pct > 30 ? '#e67e22' : '#c0392b';
}

function selectToken(id) {
  if (State.selectedTokenId) {
    const prev = $('token-el-' + State.selectedTokenId);
    if (prev) prev.classList.remove('selected');
  }
  State.selectedTokenId = id;
  const panel = $('token-info-panel');
  if (!id) {
    if (panel) panel.classList.remove('visible');
    return;
  }
  const t = State.tokens.find(t => t.id === id);
  if (!t || !panel) return;
  const el = $('token-el-' + id);
  if (el) el.classList.add('selected');
  const tipName = $('tip-name'); if (tipName) tipName.textContent = t.name;
  const tipType = $('tip-type'); if (tipType) tipType.textContent = { joueur:'🧙 Joueur', ennemi:'💀 Ennemi', pnj:'🗣 PNJ' }[t.type] || t.type;
  const tipFill = $('tip-hp-fill');
  if (tipFill) updateHpFill(tipFill, t.hp, t.hpMax);
  const tipText = $('tip-hp-text'); if (tipText) tipText.textContent = `${t.hp}/${t.hpMax}`;
  panel.classList.add('visible');
}

function adjustHP(id, delta) {
  const t = State.tokens.find(t => t.id === id);
  if (!t) return;
  const amount = delta > 0 ? 1 : -1;
  t.hp = Math.max(0, Math.min(t.hpMax, t.hp + amount));
  const fill = $('hp-fill-' + id);
  if (fill) updateHpFill(fill, t.hp, t.hpMax);
  const tipFill = $('tip-hp-fill'); if (tipFill) updateHpFill(tipFill, t.hp, t.hpMax);
  const tipText = $('tip-hp-text'); if (tipText) tipText.textContent = `${t.hp}/${t.hpMax}`;
  saveToStorage();
}

function deleteToken(id) {
  const el = $('token-el-' + id);
  if (el) el.remove();
  State.tokens = State.tokens.filter(t => t.id !== id);
  try { localStorage.removeItem('co-tok-img-' + id); } catch (_) {}
  if (State.selectedTokenId === id) selectToken(null);
  updateInfoDisplay();
  saveToStorage();
  showToast('Pion supprimé', 'info', '✕');
}

function moveTokenEl(id, worldX, worldY) {
  const t = State.tokens.find(t => t.id === id);
  if (!t) return;
  const cellPx = State.gridCellSize;
  let x = worldX, y = worldY;
  if (State.snapToGrid && State.gridVisible) {
    x = Math.round(x / cellPx) * cellPx;
    y = Math.round(y / cellPx) * cellPx;
  }
  t.x = x; t.y = y;
  const sizePx = cellPx * t.size;
  const el = $('token-el-' + id);
  if (el) {
    el.style.left = (x - sizePx / 2) + 'px';
    el.style.top  = (y - sizePx / 2) + 'px';
  }
}

function setupTokenDrag() {
  const vp = $('map-viewport');
  if (!vp) return;

  vp.addEventListener('mousedown', (e) => {
    if (State.fogPainting) return;
    const tokenEl = e.target.closest('.vtt-token');
    if (!tokenEl || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = tokenEl.dataset.tokenId;
    State.tokenDragging = true;
    State.tokenDragId = id;
    tokenEl.classList.add('dragging');
    const rect = vp.getBoundingClientRect();
    const mouseWorldX = (e.clientX - rect.left - State.panX) / State.zoom;
    const mouseWorldY = (e.clientY - rect.top  - State.panY) / State.zoom;
    const t = State.tokens.find(t => t.id === id);
    if (t) { State.tokenDragOffX = mouseWorldX - t.x; State.tokenDragOffY = mouseWorldY - t.y; }
    selectToken(id);
  });

  window.addEventListener('mousemove', (e) => {
    if (!State.tokenDragging || !State.tokenDragId) return;
    const rect = vp.getBoundingClientRect();
    const wx = (e.clientX - rect.left - State.panX) / State.zoom - State.tokenDragOffX;
    const wy = (e.clientY - rect.top  - State.panY) / State.zoom - State.tokenDragOffY;
    moveTokenEl(State.tokenDragId, wx, wy);
  });

  window.addEventListener('mouseup', (e) => {
    if (!State.tokenDragging) return;
    if (State.tokenDragId) {
      const el = $('token-el-' + State.tokenDragId);
      if (el) el.classList.remove('dragging');
      saveToStorage();
    }
    State.tokenDragging = false;
    State.tokenDragId = null;
  });
}

function renderTokensListPanel() {
  const container = $('tokens-list-panel');
  if (!container) return;
  container.innerHTML = '';
  if (!State.tokens.length) {
    container.innerHTML = '<span style="color:var(--text-muted);font-style:italic;font-size:0.8rem;">Aucun pion sur la carte.</span>';
    return;
  }
  State.tokens.forEach(t => {
    const row = document.createElement('div');
    row.className = 'token-list-row';
    const avatar = document.createElement('div');
    avatar.className = 'token-list-avatar';
    if (t.type === 'ennemi') avatar.style.borderColor = '#c0392b';
    else if (t.type === 'pnj') avatar.style.borderColor = '#8e44ad';
    if (t.imgData) {
      const img = document.createElement('img');
      img.src = t.imgData;
      avatar.appendChild(img);
    } else {
      avatar.textContent = t.icon || defaultIcon(t.type);
    }
    const info = document.createElement('div');
    info.className = 'token-list-info';
    info.innerHTML = `<div class="token-list-name">${t.name}</div><div class="token-list-meta">${{ joueur:'Joueur', ennemi:'Ennemi', pnj:'PNJ' }[t.type]} · ${t.hp}/${t.hpMax} PV</div>`;
    const actions = document.createElement('div');
    actions.className = 'token-list-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'token-list-btn';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => openTokenEditModal(t.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'token-list-btn del';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => { deleteToken(t.id); renderTokensListPanel(); });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(avatar);
    row.appendChild(info);
    row.appendChild(actions);
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selectToken(t.id);
      closeAllModals();
    });
    container.appendChild(row);
  });
}

// ═════════════════════════════════════════════════════════════════════════
//  PHASE 2 — BROUILLARD DE GUERRE
// ═════════════════════════════════════════════════════════════════════════
function ensureFogCanvas() {
  const layer = $('fog-layer');
  if (!layer) return;
  let canvas = $('fog-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fog-canvas';
    layer.appendChild(canvas);
  }
  return canvas;
}

function resizeFogCanvas() {
  const mapImg = $('map-image');
  const canvas = $('fog-canvas');
  if (!canvas || !mapImg || !mapImg.naturalWidth) return;
  const w = mapImg.naturalWidth;
  const h = mapImg.naturalHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
  canvas.style.width  = mapImg.style.width  || mapImg.width  + 'px';
  canvas.style.height = mapImg.style.height || mapImg.height + 'px';
}

function applyFogVisibility() {
  const layer = $('fog-layer');
  if (!layer) return;
  layer.style.display = State.fogEnabled ? 'block' : 'none';
  const fogBtn = $('btn-fog-toggle');
  if (fogBtn) fogBtn.classList.toggle('active', State.fogEnabled);
}

function applyFogOpacity() {
  const canvas = $('fog-canvas');
  if (canvas) canvas.style.opacity = State.fogOpacity;
}

function restoreFogCanvas() {
  try {
    const canvas = ensureFogCanvas();
    if (!canvas) return;
    const key = 'co-fog-map-' + (State.currentSceneId || 'default');
    const dataUrl = localStorage.getItem(key);
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      if (canvas.width === 0) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      applyFogOpacity();
    };
    img.src = dataUrl;
  } catch (e) {}
}

function fogRevealAll() {
  const canvas = $('fog-canvas');
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  saveToStorage();
  showToast('Toute la carte révélée', 'success', '☀');
}

function fogHideAll() {
  const canvas = $('fog-canvas');
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveToStorage();
  showToast('Carte couverte', 'info', '🌑');
}

function setupFogPainting() {
  const vp = $('map-viewport');
  if (!vp) return;
  const cursor = $('fog-brush-cursor');

  let painting = false;

  function screenToWorld(clientX, clientY) {
    const rect = vp.getBoundingClientRect();
    return {
      x: (clientX - rect.left  - State.panX) / State.zoom,
      y: (clientY - rect.top   - State.panY) / State.zoom,
    };
  }

  function paintFog(clientX, clientY) {
    if (!State.fogEnabled) return;
    const canvas = $('fog-canvas');
    if (!canvas || !canvas.width) return;
    const { x, y } = screenToWorld(clientX, clientY);
    const r = State.fogBrushSize * State.gridCellSize * 0.5;
    const ctx = canvas.getContext('2d');
    if (State.fogTool === 'reveal') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateCursor(clientX, clientY) {
    if (!cursor) return;
    if (State.fogPainting) {
      const r = State.fogBrushSize * State.gridCellSize * State.zoom * 0.5;
      cursor.style.display = 'block';
      cursor.style.width  = r * 2 + 'px';
      cursor.style.height = r * 2 + 'px';
      cursor.style.left   = clientX + 'px';
      cursor.style.top    = clientY  + 'px';
    } else {
      cursor.style.display = 'none';
    }
  }

  vp.addEventListener('mousedown', (e) => {
    if (!State.fogEnabled || !State.fogPainting) return;
    if (e.target.closest('.vtt-token')) return;
    if (e.button === 0) { painting = true; paintFog(e.clientX, e.clientY); }
    if (e.button === 2) {
      State.fogPainting = false;
      vp.classList.remove('fog-painting');
      if (cursor) cursor.style.display = 'none';
    }
  });

  window.addEventListener('mousemove', (e) => {
    updateCursor(e.clientX, e.clientY);
    if (painting && State.fogPainting) paintFog(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', (e) => {
    if (painting) { painting = false; saveToStorage(); }
  });

  vp.addEventListener('contextmenu', (e) => {
    if (State.fogPainting) { e.preventDefault(); State.fogPainting = false; vp.classList.remove('fog-painting'); if (cursor) cursor.style.display = 'none'; }
  });

  $('btn-fog-toggle')?.addEventListener('click', () => {
    if (!State.fogEnabled) return;
    State.fogPainting = !State.fogPainting;
    vp.classList.toggle('fog-painting', State.fogPainting);
    if (!State.fogPainting && cursor) cursor.style.display = 'none';
    showToast(State.fogPainting ? 'Mode peinture brouillard — Clic droit pour quitter' : 'Mode peinture désactivé', 'info', '🌫');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && State.fogPainting) {
      State.fogPainting = false;
      vp.classList.remove('fog-painting');
      if (cursor) cursor.style.display = 'none';
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════
//  STYLES DYNAMIQUES
// ═════════════════════════════════════════════════════════════════════════
(function injectDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Initiative Track */
    .init-track {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: 2px 0;
      scrollbar-width: none;
    }
    .init-track::-webkit-scrollbar { display: none; }
    .init-empty {
      font-family: 'Crimson Text', serif;
      font-style: italic;
      color: var(--text-muted);
      font-size: 0.82rem;
    }
    .init-slot {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px 3px 6px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      font-family: 'Cinzel', serif;
      font-size: 0.7rem;
      color: var(--text-secondary);
      cursor: pointer;
      transition: var(--transition);
      white-space: nowrap;
      user-select: none;
    }
    .init-slot:hover {
      border-color: rgba(201,168,76,0.3);
      color: var(--text-primary);
    }
    .init-slot.active {
      background: rgba(201,168,76,0.12);
      border-color: var(--gold);
      color: var(--gold-light);
      box-shadow: 0 0 12px rgba(201,168,76,0.2);
    }
    .init-slot.enemy.active {
      background: rgba(192,57,43,0.12);
      border-color: var(--blood);
      color: #e74c3c;
      box-shadow: 0 0 12px rgba(192,57,43,0.2);
    }
    .init-icon { font-size: 0.85rem; }
    .init-name { font-weight: 600; }
    .init-score {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      color: var(--text-muted);
    }
    .init-slot.active .init-score { color: var(--gold-dim); }

    /* Tokens */
    .vtt-token {
      position: absolute;
      border: 2px solid;
      border-radius: 50%;
      background: rgba(10, 8, 22, 0.6);
      cursor: move;
      transition: box-shadow 0.15s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      user-select: none;
      z-index: 4;
    }
    .vtt-token:hover {
      box-shadow: 0 0 20px rgba(201, 168, 76, 0.3);
    }
    .vtt-token.selected {
      box-shadow: 0 0 30px rgba(201, 168, 76, 0.6), inset 0 0 10px rgba(201, 168, 76, 0.2);
    }
    .vtt-token.dragging {
      opacity: 0.9;
      box-shadow: 0 0 40px rgba(201, 168, 76, 0.8);
    }
    .vtt-token.ennemi { border-color: #c0392b; }
    .vtt-token.pnj { border-color: #8e44ad; }
    .token-inner {
      font-size: 1.2rem;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .token-inner img {
      width: 80%;
      height: 80%;
      border-radius: 50%;
      object-fit: cover;
    }
    .token-label {
      position: absolute;
      bottom: -18px;
      left: 50%;
      transform: translateX(-50%);
      font-family: 'Cinzel', serif;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--gold-light);
      white-space: nowrap;
      background: rgba(10, 8, 22, 0.8);
      padding: 2px 8px;
      border-radius: 12px;
      pointer-events: none;
    }
    .token-hp-bar {
      position: absolute;
      bottom: -6px;
      width: 100%;
      height: 2px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 1px;
      overflow: hidden;
    }
    .token-hp-fill {
      height: 100%;
      background: #27ae60;
      width: 100%;
      transition: width 0.3s ease, background 0.3s ease;
    }

    /* Info Panel Token */
    #token-info-panel {
      position: fixed;
      bottom: 72px;
      right: 12px;
      width: 200px;
      background: rgba(10, 8, 22, 0.95);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 12px;
      display: none;
      flex-direction: column;
      gap: 8px;
      backdrop-filter: blur(8px);
      z-index: 100;
    }
    #token-info-panel.visible { display: flex; }
    .tip-name {
      font-family: 'Cinzel', serif;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--gold-light);
    }
    .tip-type {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .tip-hp-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
    }
    .tip-hp-bar {
      flex: 1;
      height: 4px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 2px;
      overflow: hidden;
    }
    .tip-hp-fill {
      height: 100%;
      background: #27ae60;
      width: 100%;
    }
    .tip-hp-text {
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-muted);
    }
    .tip-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      margin-top: 4px;
    }
    .tip-btn {
      padding: 4px 6px;
      background: rgba(201, 168, 76, 0.12);
      border: 1px solid var(--gold-dim);
      border-radius: 4px;
      color: var(--gold-light);
      font-family: 'Cinzel', serif;
      font-size: 0.65rem;
      cursor: pointer;
      transition: var(--transition);
    }
    .tip-btn:hover { background: rgba(201, 168, 76, 0.2); box-shadow: 0 0 8px rgba(201, 168, 76, 0.2); }
    .tip-btn.danger { background: rgba(192, 57, 43, 0.15); border-color: var(--blood); color: #e74c3c; }
    .tip-btn.danger:hover { background: rgba(192, 57, 43, 0.3); }

    /* Token list */
    .token-list-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      cursor: pointer;
      transition: var(--transition);
    }
    .token-list-row:hover { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.1); }
    .token-list-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid var(--gold);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
      background: rgba(10, 8, 22, 0.6);
    }
    .token-list-avatar img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }
    .token-list-info { flex: 1; min-width: 0; }
    .token-list-name {
      font-family: 'Cinzel', serif;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .token-list-meta {
      font-size: 0.65rem;
      color: var(--text-muted);
    }
    .token-list-actions { display: flex; gap: 4px; }
    .token-list-btn {
      padding: 4px 6px;
      background: rgba(201, 168, 76, 0.1);
      border: 1px solid var(--gold-dim);
      border-radius: 4px;
      color: var(--gold-light);
      cursor: pointer;
      font-size: 0.75rem;
      transition: var(--transition);
    }
    .token-list-btn:hover { background: rgba(201, 168, 76, 0.2); }
    .token-list-btn.del { background: rgba(192, 57, 43, 0.1); border-color: var(--blood); color: #e74c3c; }
    .token-list-btn.del:hover { background: rgba(192, 57, 43, 0.2); }

    /* Fog brush cursor */
    #fog-brush-cursor {
      position: fixed;
      border: 2px solid rgba(201, 168, 76, 0.6);
      border-radius: 50%;
      pointer-events: none;
      display: none;
      z-index: 200;
      transform: translate(-50%, -50%);
    }

    /* Settings group fix */
    .settings-group { padding-bottom: 12px; }
  `;
  document.head.appendChild(style);
})();

// ═════════════════════════════════════════════════════════════════════════
//  BOOT
// ═════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initSplashParticles();
  $('btn-enter')?.addEventListener('click', enterApp);
});
