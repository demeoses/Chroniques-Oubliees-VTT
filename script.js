/* ══════════════════════════════════════════════════════════════════════════
   CHRONIQUES OUBLIÉES · VTT · script.js
   Version 2.8 — Stabilisation Phase 2 + Préparation Phase 3
   ══════════════════════════════════════════════════════════════════════════
   CORRECTIONS PHASE 2.8 :
   - Grille professionnelle : worldToGrid / gridToWorld / snapToGrid
   - Tokens : dragThreshold=5, snap correct au centre de case
   - Brouillard par cases (fogData), plus de cercle approximatif
   - InteractionManager : SELECT | PAN | FOG_PAINT | MEASURE
   - cancelCurrentInteraction() propre
   - Sauvegarde fog différée (debounce, plus de toDataURL en continu)
   AJOUTS PHASE 3 (architecture) :
   - PlayerManager
   - SyncManager
   - NetworkAdapter / LocalAdapter
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
  // Drag threshold — le drag ne démarre qu'après 5px de mouvement
  _tokenDragStartX: 0,
  _tokenDragStartY: 0,
  _tokenDragPending: false,
  _tokenDragPendingId: null,

  // Brouillard Phase 2 — stockage par cases
  fogEnabled: false,
  fogOpacity: 0.85,
  fogPainting: false,
  fogTool: 'reveal',
  fogBrushSize: 2,
  // fogData : objet { "col,row": true } — true = case visible (révélée)
  fogData: {},

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

// Pas de tokens ni de héros par défaut — les campagnes commencent vides.

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

    // PHASE 2.8 : Sauvegarder brouillard par cases (fogData) — pas de toDataURL
    try {
      const fogKey = 'co-fog-cells-' + (State.currentSceneId || 'default');
      localStorage.setItem(fogKey, JSON.stringify(State.fogData));
    } catch (_) {}

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

// Sauvegarde différée du brouillard — évite les écritures en continu pendant le peinture
let _fogSaveTimer = null;
function saveFogDebounced() {
  clearTimeout(_fogSaveTimer);
  _fogSaveTimer = setTimeout(() => {
    try {
      const fogKey = 'co-fog-cells-' + (State.currentSceneId || 'default');
      localStorage.setItem(fogKey, JSON.stringify(State.fogData));
    } catch (_) {}
  }, 400);
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

    // PHASE 2.8 : Restaurer fogData par cases depuis localStorage
    // Chercher d'abord le nouveau format (cases), puis fallback sur l'ancien (image canvas)
    const fogCellKey = 'co-fog-cells-' + (State.currentSceneId || 'default');
    const fogCellsRaw = localStorage.getItem(fogCellKey);
    if (fogCellsRaw) {
      try {
        State.fogData = JSON.parse(fogCellsRaw);
      } catch (_) {
        State.fogData = {};
      }
    } else {
      State.fogData = {};
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
  State.fogData = {};

  // Nettoyer DOM
  document.querySelectorAll('.vtt-token').forEach(e => e.remove());
  const tokensList = $('tokens-list-panel');
  if (tokensList) tokensList.innerHTML = '<span style="color:var(--text-muted);font-style:italic;font-size:0.8rem;">Aucun pion sur la carte.</span>';
  const scenesList = $('scenes-list');
  if (scenesList) scenesList.innerHTML = '';

  // Vider et redessiner le canvas brouillard
  const fogCanvas = $('fog-canvas');
  if (fogCanvas && fogCanvas.width) {
    fogCanvas.getContext('2d').clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  }
  applyFogVisibility();
  redrawFogCanvas();

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

  // Phase 3 — Initialiser le joueur local
  PlayerManager.initLocal();

  // Phase 3.1 — Setup multijoueur UI
  setupMultiplayer();

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

  // Restaurer les données de brouillard pour cette scène
  const fogCellKey = 'co-fog-cells-' + scene.id;
  const fogCellsRaw = localStorage.getItem(fogCellKey);
  if (fogCellsRaw) {
    try { State.fogData = JSON.parse(fogCellsRaw); } catch (_) { State.fogData = {}; }
  } else {
    State.fogData = {};
  }

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
        redrawFogCanvas();
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
  // Phase 3
  SyncManager.sceneChanged(scene.id);
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
    // Ne pas déclencher le pan si on clique sur un token
    if (e.target.closest('.vtt-token')) return;
    // Ne pas déclencher si on est en mode fog painting
    if (State.fogPainting) return;
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
    if (e.button === 1 || State.isPanning) {
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
//  GRILLE PROFESSIONNELLE — Référence logique
// ══════════════════════════════════════════════════════════════════════════

/**
 * Convertit des coordonnées monde (pixels) en coordonnées grille (col, row).
 * Retourne { col, row } — entiers, indexés depuis 0.
 */
function worldToGrid(wx, wy) {
  const cell = State.gridCellSize;
  return {
    col: Math.floor(wx / cell),
    row: Math.floor(wy / cell),
  };
}

/**
 * Convertit des coordonnées grille (col, row) en coordonnées monde (pixels).
 * Retourne { x, y } — le coin supérieur gauche de la case.
 */
function gridToWorld(col, row) {
  const cell = State.gridCellSize;
  return {
    x: col * cell,
    y: row * cell,
  };
}

/**
 * Accroche des coordonnées monde au CENTRE de la case grille la plus proche.
 * C'est la fonction à appeler lors du relâchement d'un token.
 */
function snapToGrid(wx, wy) {
  const cell = State.gridCellSize;
  const col = Math.floor(wx / cell);
  const row = Math.floor(wy / cell);
  return {
    x: col * cell + cell / 2,
    y: row * cell + cell / 2,
  };
}

/**
 * Convertit des coordonnées écran en coordonnées monde.
 * Prend en compte pan et zoom.
 */
function screenToWorld(clientX, clientY) {
  const vp = $('map-viewport');
  if (!vp) return { x: 0, y: 0 };
  const rect = vp.getBoundingClientRect();
  return {
    x: (clientX - rect.left  - State.panX) / State.zoom,
    y: (clientY - rect.top   - State.panY) / State.zoom,
  };
}

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

  // Calcul de l'offset : on aligne la grille sur l'origine de la carte (panX, panY)
  // pour éviter tout décalage entre grille visuelle et coordonnées internes
  const offsetX = ((State.panX % cellSize) + cellSize) % cellSize;
  const offsetY = ((State.panY % cellSize) + cellSize) % cellSize;

  ctx.strokeStyle = State.gridColor;
  ctx.globalAlpha = State.gridOpacity;
  ctx.lineWidth = 0.8;

  ctx.beginPath();
  for (let x = offsetX; x <= canvas.width; x += cellSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = offsetY; y <= canvas.height; y += cellSize) {
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
//  INTERACTION MANAGER
//  Un seul système gère tous les modes : SELECT | PAN | FOG_PAINT | MEASURE
// ══════════════════════════════════════════════════════════════════════════

/**
 * Annule toute interaction en cours avant de changer d'outil.
 * Appelé systématiquement à chaque changement d'outil.
 */
function cancelCurrentInteraction() {
  // Arrêter caméra
  State.isPanning = false;
  const vp = $('map-viewport');
  if (vp) vp.style.cursor = 'default';

  // Arrêter drag token
  if (State.tokenDragging && State.tokenDragId) {
    const el = $('token-el-' + State.tokenDragId);
    if (el) el.classList.remove('dragging');
  }
  State.tokenDragging = false;
  State.tokenDragId = null;
  State._tokenDragPending = false;
  State._tokenDragPendingId = null;

  // Arrêter peinture brouillard
  if (State.fogPainting) {
    State.fogPainting = false;
    if (vp) vp.classList.remove('fog-painting');
    const cursor = $('fog-brush-cursor');
    if (cursor) cursor.style.display = 'none';
  }
}

function activateTool(tool) {
  cancelCurrentInteraction();
  State.activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  const viewport = $('map-viewport');
  if (viewport) {
    viewport.style.cursor = tool === 'pan' ? 'grab' : tool === 'measure' ? 'crosshair' : 'default';
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  TOOLBAR GAUCHE
// ══════════════════════════════════════════════════════════════════════════
function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      activateTool(btn.dataset.tool);
      const labelEl = btn.querySelector('span');
      updateLog(`Outil : ${labelEl?.textContent || btn.dataset.tool}`);
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
  // Note : la fermeture par Escape est gérée dans setupKeyboard()
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
//  COMBAT MANAGER
// ═════════════════════════════════════════════════════════════════════════

const CombatManager = {
  /**
   * Démarre le combat avec les tokens actuellement sur la scène.
   * Ouvre une modal de sélection des participants si des tokens existent.
   */
  startCombat() {
    if (State.tokens.length === 0) {
      showToast('Aucun pion sur la carte. Ajoutez des pions d\'abord.', 'warning', '⚠');
      return;
    }
    // Ouvrir la modal de sélection
    this._openParticipantModal();
  },

  /**
   * Ouvre la modal de sélection des participants au combat.
   */
  _openParticipantModal() {
    const modal = $('modal-combat-select');
    if (!modal) return;
    const list = $('combat-participant-list');
    if (!list) return;
    list.innerHTML = '';
    State.tokens.forEach(t => {
      const item = document.createElement('label');
      item.className = 'combat-participant-item';
      const icon = t.icon || defaultIcon(t.type);
      item.innerHTML = `
        <input type="checkbox" class="combat-chk" data-token-id="${t.id}" checked />
        <span class="combat-part-icon">${icon}</span>
        <span class="combat-part-name">${t.name}</span>
        <span class="combat-part-type">${{ joueur:'Joueur', ennemi:'Ennemi', pnj:'PNJ' }[t.type] || t.type}</span>
      `;
      list.appendChild(item);
    });
    modal.classList.remove('hidden');
  },

  /**
   * Lance l'initiative pour les participants sélectionnés.
   */
  launchWithSelected() {
    const checkboxes = document.querySelectorAll('.combat-chk:checked');
    if (checkboxes.length === 0) {
      showToast('Sélectionnez au moins un participant.', 'warning', '⚠');
      return;
    }
    const participants = [];
    checkboxes.forEach(chk => {
      const t = State.tokens.find(t => t.id === chk.dataset.tokenId);
      if (!t) return;
      participants.push({
        tokenId: t.id,
        name: t.name,
        icon: t.icon || defaultIcon(t.type),
        isEnemy: t.type === 'ennemi',
        initiative: Math.floor(Math.random() * 20) + 1,
      });
    });
    participants.sort((a, b) => b.initiative - a.initiative);

    State.initiativeOrder = participants;
    State.currentTurn = 0;
    State.round = 1;
    State.combatActive = true;

    closeAllModals();
    renderInitiativeTrack();
    const rnEl = $('round-number'); if (rnEl) rnEl.textContent = State.round;
    const irEl = $('info-round');   if (irEl) irEl.textContent = State.round;
    const btn = $('btn-roll-initiative');
    if (btn) btn.innerHTML = '<span>🛑</span><small>Arrêter</small>';

    showToast(`Combat lancé ! ${participants.length} participants.`, 'success', '⚔');
    updateLog(`Combat — Round ${State.round} — Tour de ${State.initiativeOrder[0].name}`);
    // Sélectionner le token du premier participant
    if (participants[0].tokenId) selectToken(participants[0].tokenId);
  },

  /**
   * Termine le combat sans supprimer les tokens.
   */
  endCombat() {
    State.combatActive = false;
    State.round = 0;
    State.currentTurn = 0;
    State.initiativeOrder = [];
    renderInitiativeTrack();
    const rnEl = $('round-number'); if (rnEl) rnEl.textContent = '—';
    const irEl = $('info-round');   if (irEl) irEl.textContent = '—';
    const btn = $('btn-roll-initiative');
    if (btn) btn.innerHTML = '<span>⚔</span><small>Initiative</small>';
    showToast('Combat terminé — pions conservés.', 'info', '⚔');
    updateLog('Combat terminé');
  },
};

function setupInitiative() {
  $('btn-roll-initiative')?.addEventListener('click', () => {
    if (State.combatActive) {
      CombatManager.endCombat();
    } else {
      CombatManager.startCombat();
    }
  });
  $('btn-end-turn')?.addEventListener('click', nextTurn);
  $('btn-next-round')?.addEventListener('click', nextRound);

  // Bouton confirmer dans la modal de sélection
  $('btn-combat-launch')?.addEventListener('click', () => CombatManager.launchWithSelected());
  $('btn-combat-cancel')?.addEventListener('click', closeAllModals);
}

function nextTurn() {
  if (!State.combatActive || !State.initiativeOrder.length) return;
  State.currentTurn = (State.currentTurn + 1) % State.initiativeOrder.length;
  if (State.currentTurn === 0) {
    nextRound();
    return;
  }
  renderInitiativeTrack();
  const current = State.initiativeOrder[State.currentTurn];
  updateLog(`Tour de ${current.name} (initiative ${current.initiative})`);
  // Sélectionner le token actif sur la carte
  if (current.tokenId) selectToken(current.tokenId);
}

function nextRound() {
  if (!State.combatActive) return;
  State.round++;
  State.currentTurn = 0;
  const rnEl = $('round-number'); if (rnEl) rnEl.textContent = State.round;
  const irEl = $('info-round');   if (irEl) irEl.textContent = State.round;
  renderInitiativeTrack();
  showToast(`Round ${State.round}`, 'info', '🔄');
  const first = State.initiativeOrder[0];
  updateLog(`Round ${State.round} — Tour de ${first.name}`);
  if (first.tokenId) selectToken(first.tokenId);
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
      if (c.tokenId) selectToken(c.tokenId);
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
      case 'escape':
        closeAllModals();
        // Quitter le mode peinture brouillard si actif
        if (State.fogPainting) cancelCurrentInteraction();
        break;
      case 't': openTokenCreateModal(); break;
    }
  });
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
  redrawFogCanvas();

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

  // Click viewport background → deselect (NOT on token, NOT in fog painting)
  $('map-viewport')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.vtt-token') && !State.fogPainting && e.button === 0 && State.activeTool === 'select') {
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
    // Snapper au centre de la case si la grille est visible
    let tx = cx, ty = cy;
    if (State.snapToGrid && State.gridVisible) {
      const snapped = snapToGrid(cx, cy);
      tx = snapped.x;
      ty = snapped.y;
    }
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
      x: tx,
      y: ty,
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

function moveTokenEl(id, worldX, worldY, doSnap) {
  const t = State.tokens.find(t => t.id === id);
  if (!t) return;
  const cellPx = State.gridCellSize;
  let x = worldX, y = worldY;
  // Snap au CENTRE de la case (uniquement au relâchement si doSnap === true)
  if (doSnap && State.snapToGrid && State.gridVisible) {
    const snapped = snapToGrid(x, y);
    x = snapped.x;
    y = snapped.y;
  }
  t.x = x; t.y = y;
  const sizePx = cellPx * t.size;
  const el = $('token-el-' + id);
  if (el) {
    // Le token est positionné par son centre
    el.style.left = (x - sizePx / 2) + 'px';
    el.style.top  = (y - sizePx / 2) + 'px';
  }
  // Phase 3 : émettre l'événement de synchronisation au snap final
  if (doSnap) {
    SyncManager.tokenMoved(id, x, y);
  }
}

function setupTokenDrag() {
  const vp = $('map-viewport');
  if (!vp) return;

  const DRAG_THRESHOLD = 5; // pixels avant que le drag démarre

  // Phase de capture : on intercepte AVANT tout stopPropagation éventuel
  document.addEventListener('mousedown', (e) => {
    if (State.fogPainting) return;
    if (State.activeTool !== 'select') return;
    const tokenEl = e.target.closest('.vtt-token');
    if (!tokenEl || e.button !== 0) return;
    if (!vp.contains(tokenEl)) return;
    e.preventDefault();
    const id = tokenEl.dataset.tokenId;
    selectToken(id);
    State._tokenDragPending = true;
    State._tokenDragPendingId = id;
    State._tokenDragStartX = e.clientX;
    State._tokenDragStartY = e.clientY;
    const rect = vp.getBoundingClientRect();
    const mouseWorldX = (e.clientX - rect.left - State.panX) / State.zoom;
    const mouseWorldY = (e.clientY - rect.top  - State.panY) / State.zoom;
    const t = State.tokens.find(t => t.id === id);
    if (t) {
      State.tokenDragOffX = mouseWorldX - t.x;
      State.tokenDragOffY = mouseWorldY - t.y;
    }
  }, true);

  window.addEventListener('mousemove', (e) => {
    // Démarrer le drag réel seulement après le seuil de 5px
    if (State._tokenDragPending && !State.tokenDragging) {
      const dx = e.clientX - State._tokenDragStartX;
      const dy = e.clientY - State._tokenDragStartY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        State.tokenDragging = true;
        State.tokenDragId = State._tokenDragPendingId;
        const dragEl = $('token-el-' + State.tokenDragId);
        if (dragEl) dragEl.classList.add('dragging');
      }
    }

    if (!State.tokenDragging || !State.tokenDragId) return;
    const rect = vp.getBoundingClientRect();
    const wx = (e.clientX - rect.left - State.panX) / State.zoom - State.tokenDragOffX;
    const wy = (e.clientY - rect.top  - State.panY) / State.zoom - State.tokenDragOffY;
    // Pendant le drag : pas de snap, le token suit la souris librement
    moveTokenEl(State.tokenDragId, wx, wy, false);
  });

  window.addEventListener('mouseup', (e) => {
    // Annuler le drag pending (clic sans drag)
    State._tokenDragPending = false;
    State._tokenDragPendingId = null;

    if (!State.tokenDragging) return;
    if (State.tokenDragId) {
      const el = $('token-el-' + State.tokenDragId);
      if (el) el.classList.remove('dragging');
      // Au relâchement : snap obligatoire au centre de la case
      const t = State.tokens.find(t => t.id === State.tokenDragId);
      if (t) {
        moveTokenEl(State.tokenDragId, t.x, t.y, true);
      }
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
//  PHASE 2 — BROUILLARD DE GUERRE PAR CASES
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
    // Remplir de noir (tout caché) si pas de fogData existant
    if (Object.keys(State.fogData).length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
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

// ──────────────────────────────────────────────────────────────────────────
//  API CASES DE BROUILLARD
// ──────────────────────────────────────────────────────────────────────────

/**
 * Révèle une case (la rend visible = transparent dans le canvas).
 */
function revealCell(col, row) {
  const key = col + ',' + row;
  State.fogData[key] = true;
}

/**
 * Cache une case (la rend opaque dans le canvas).
 */
function hideCell(col, row) {
  const key = col + ',' + row;
  delete State.fogData[key];
}

/**
 * Retourne true si la case est visible (révélée).
 */
function isCellVisible(col, row) {
  return !!(State.fogData[col + ',' + row]);
}

/**
 * Redessine le canvas brouillard entier depuis fogData.
 * Appeler après chargement de scène ou restauration.
 * Optimisé : on remplit tout en noir puis on efface les cases révélées.
 */
function redrawFogCanvas() {
  const canvas = $('fog-canvas');
  if (!canvas || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext('2d');
  const cell = State.gridCellSize;

  // Fond opaque (tout caché)
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Effacer les cases révélées
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  for (const key of Object.keys(State.fogData)) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillRect(c * cell, r * cell, cell, cell);
  }
  ctx.globalCompositeOperation = 'source-over';
  applyFogOpacity();
}

// ──────────────────────────────────────────────────────────────────────────
//  PINCEAU PAR CASES
// ──────────────────────────────────────────────────────────────────────────

/**
 * Applique le pinceau brouillard sur le canvas pour un carré de cases centré
 * sur la case (col, row), de taille brushSize x brushSize.
 */
function paintFogCells(worldX, worldY) {
  if (!State.fogEnabled) return;
  const canvas = $('fog-canvas');
  if (!canvas || !canvas.width) return;
  const cell = State.gridCellSize;
  const { col: centerCol, row: centerRow } = worldToGrid(worldX, worldY);
  const half = Math.floor(State.fogBrushSize / 2);
  const ctx = canvas.getContext('2d');

  for (let dc = -half; dc < State.fogBrushSize - half; dc++) {
    for (let dr = -half; dr < State.fogBrushSize - half; dr++) {
      const col = centerCol + dc;
      const row = centerRow + dr;
      if (col < 0 || row < 0) continue;
      if (State.fogTool === 'reveal') {
        revealCell(col, row);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(col * cell, row * cell, cell, cell);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        hideCell(col, row);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000';
        ctx.fillRect(col * cell, row * cell, cell, cell);
      }
    }
  }
}

function fogRevealAll() {
  const canvas = $('fog-canvas');
  if (!canvas || !canvas.width) return;
  const ctx = canvas.getContext('2d');
  // Calculer le nombre de cases depuis la taille du canvas
  const cell = State.gridCellSize;
  const cols = Math.ceil(canvas.width / cell);
  const rows = Math.ceil(canvas.height / cell);
  State.fogData = {};
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      State.fogData[c + ',' + r] = true;
    }
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  saveFogDebounced();
  saveToStorage();
  showToast('Toute la carte révélée', 'success', '☀');
}

function fogHideAll() {
  const canvas = $('fog-canvas');
  if (!canvas || !canvas.width) return;
  State.fogData = {};
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveFogDebounced();
  saveToStorage();
  showToast('Carte couverte', 'info', '🌑');
}

// ──────────────────────────────────────────────────────────────────────────
//  SETUP PEINTURE BROUILLARD
// ──────────────────────────────────────────────────────────────────────────
function setupFogPainting() {
  const vp = $('map-viewport');
  if (!vp) return;
  const cursor = $('fog-brush-cursor');

  let painting = false;

  function updateCursor(clientX, clientY) {
    if (!cursor) return;
    if (State.fogPainting) {
      // Taille du curseur = taille du pinceau en cases × taille d'une case × zoom
      const r = State.fogBrushSize * State.gridCellSize * State.zoom;
      cursor.style.display = 'block';
      cursor.style.width  = r + 'px';
      cursor.style.height = r + 'px';
      cursor.style.left   = clientX + 'px';
      cursor.style.top    = clientY  + 'px';
    } else {
      cursor.style.display = 'none';
    }
  }

  vp.addEventListener('mousedown', (e) => {
    // Ne pas réagir si on n'est pas en mode fog painting
    if (!State.fogEnabled || !State.fogPainting) return;
    if (e.target.closest('.vtt-token')) return;
    if (e.button === 0) {
      painting = true;
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      paintFogCells(x, y);
    }
    if (e.button === 2) {
      // Clic droit = quitter le mode peinture
      cancelCurrentInteraction();
    }
  });

  window.addEventListener('mousemove', (e) => {
    updateCursor(e.clientX, e.clientY);
    if (painting && State.fogPainting) {
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      paintFogCells(x, y);
      saveFogDebounced();
    }
  });

  window.addEventListener('mouseup', () => {
    if (painting) {
      painting = false;
      saveFogDebounced();
    }
  });

  vp.addEventListener('contextmenu', (e) => {
    if (State.fogPainting) {
      e.preventDefault();
      cancelCurrentInteraction();
    }
  });

  $('btn-fog-toggle')?.addEventListener('click', () => {
    if (!State.fogEnabled) return;
    // Basculer le mode peinture
    if (State.fogPainting) {
      cancelCurrentInteraction();
      showToast('Mode peinture désactivé', 'info', '🌫');
    } else {
      cancelCurrentInteraction(); // Annule tout autre outil actif
      State.fogPainting = true;
      vp.classList.add('fog-painting');
      showToast('Mode peinture brouillard — Clic droit pour quitter', 'info', '🌫');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && State.fogPainting) {
      cancelCurrentInteraction();
    }
  });
}


// ═════════════════════════════════════════════════════════════════════════
//  STYLES DYNAMIQUES — uniquement les règles absentes de style.css
// ═════════════════════════════════════════════════════════════════════════
(function injectDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Fog brush cursor — carré pour refléter le pinceau par cases */
    #fog-brush-cursor {
      border-radius: 0 !important;
      border: 2px solid rgba(201, 168, 76, 0.8) !important;
      background: rgba(201, 168, 76, 0.06) !important;
    }
  `;
  document.head.appendChild(style);
})();

// ═════════════════════════════════════════════════════════════════════════
//  PHASE 3 — ARCHITECTURE MULTIJOUEUR (base, pas encore actif)
// ═════════════════════════════════════════════════════════════════════════

/**
 * PlayerManager — gère les joueurs, rôles et permissions.
 * Utilisé en solo pour l'instant (un joueur = le MJ).
 */
const PlayerManager = {
  players: [],

  /**
   * Ajoute ou met à jour un joueur.
   * @param {{ id:string, name:string, role:'mj'|'joueur', color:string }} player
   */
  upsertPlayer(player) {
    const idx = this.players.findIndex(p => p.id === player.id);
    if (idx >= 0) {
      this.players[idx] = { ...this.players[idx], ...player };
    } else {
      this.players.push(player);
    }
  },

  getPlayer(id) {
    return this.players.find(p => p.id === id) || null;
  },

  /** Retourne true si le joueur a la permission demandée. */
  hasPermission(playerId, action) {
    const p = this.getPlayer(playerId);
    if (!p) return false;
    if (p.role === 'mj') return true;
    const PLAYER_PERMISSIONS = ['move_own_token', 'roll_dice', 'view_map'];
    return PLAYER_PERMISSIONS.includes(action);
  },

  /** Initialise le joueur local depuis State. */
  initLocal() {
    if (!State.playerId) {
      State.playerId = 'player-' + Date.now();
    }
    this.upsertPlayer({
      id: State.playerId,
      name: State.campaignName,
      role: State.playerRole,
      color: '#c9a84c',
    });
  },
};

/**
 * SyncManager — prépare les événements de synchronisation.
 * En mode local, les événements sont consommés immédiatement.
 * En mode réseau (Phase 3 suivante), ils seront envoyés via NetworkAdapter.
 */
const SyncManager = {
  _handlers: {},

  /** Émet un événement de synchronisation. */
  emit(event, payload) {
    // Appeler les handlers locaux
    const handlers = this._handlers[event] || [];
    handlers.forEach(h => {
      try { h(payload); } catch (e) { console.warn('SyncManager handler error:', e); }
    });
    // Transmettre au NetworkAdapter (no-op en mode local)
    NetworkAdapter.send(event, payload);
  },

  /** Écoute un événement. */
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
  },

  // Événements prédéfinis Phase 3
  tokenMoved(tokenId, x, y) {
    this.emit('tokenMoved', { tokenId, x, y, playerId: State.playerId });
  },
  sceneChanged(sceneId) {
    this.emit('sceneChanged', { sceneId, playerId: State.playerId });
  },
  fogUpdated(fogData) {
    this.emit('fogUpdated', { fogData, playerId: State.playerId });
  },
};

/**
 * NetworkAdapter — abstraction réseau.
 * LocalAdapter : fonctionne sans serveur, tout est local.
 * WebSocketAdapter (Phase 3) : remplacera LocalAdapter.
 */
const NetworkAdapter = {
  _mode: 'local', // 'local' | 'websocket'

  /** Envoie un message (no-op en mode local). */
  send(event, payload) {
    if (this._mode === 'local') return; // Solo : rien à envoyer
    // TODO Phase 3 : this._ws.send(JSON.stringify({ event, payload }))
  },

  /** Connecte au serveur WebSocket (Phase 3). */
  connect(url) {
    // TODO Phase 3
    console.info('[NetworkAdapter] WebSocket non implémenté — Phase 3');
  },

  /** Retourne l'état de connexion. */
  isConnected() {
    return this._mode !== 'local';
  },
};


// ═════════════════════════════════════════════════════════════════════════
//  PHASE 3.1 — ROOM MANAGER
// ═════════════════════════════════════════════════════════════════════════

/**
 * RoomManager — gère la salle multijoueur.
 * Phase 3.1 : architecture locale (WebSocket sera branché en Phase 3.2).
 * La salle existe côté client ; le vrai serveur viendra ensuite.
 */
const RoomManager = {
  room: null, // { id, code, name, gmId, gmName, players[], maxPlayers, createdAt }

  /** Génère un code de salle : 3 lettres + tiret + 4 chiffres ex. "HKR-4829" */
  _generateCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 3; i++) code += letters[Math.floor(Math.random() * letters.length)];
    code += '-';
    for (let i = 0; i < 4; i++) code += Math.floor(Math.random() * 10);
    return code;
  },

  /** Crée une salle (MJ). */
  createRoom(name, gmName, maxPlayers = 4) {
    const code = this._generateCode();
    const gmId = State.playerId || ('player-' + Date.now());
    State.playerId = gmId;
    State.playerRole = 'mj';

    this.room = {
      id: 'room-' + Date.now(),
      code,
      name: name || State.campaignName,
      gmId,
      gmName: gmName || 'Maître du Jeu',
      players: [{ id: gmId, name: gmName || 'Maître du Jeu', role: 'mj', online: true }],
      maxPlayers: parseInt(maxPlayers, 10) || 4,
      createdAt: Date.now(),
    };

    // Mettre à jour PlayerManager
    PlayerManager.upsertPlayer({ id: gmId, name: this.room.gmName, role: 'mj', color: '#c9a84c' });

    // Sauvegarder le code pour permettre aux joueurs de rejoindre (même navigateur/onglet pour Phase 3.1)
    try { localStorage.setItem('co-room-' + code, JSON.stringify(this.room)); } catch(_) {}

    this._applyGMMode();
    this._renderRoomPanel();
    this._updateSessionIndicator(true);

    showToast(`Salle créée : ${code}`, 'success', '🌐');
    updateLog(`Salle ouverte — Code : ${code}`);
    return this.room;
  },

  /** Rejoint une salle (Joueur). */
  joinRoom(code, playerName) {
    const clean = (code || '').toUpperCase().trim();
    let roomData = null;
    try {
      const raw = localStorage.getItem('co-room-' + clean);
      if (raw) roomData = JSON.parse(raw);
    } catch(_) {}

    if (!roomData) {
      const errEl = $('room-join-error');
      if (errEl) errEl.style.display = 'block';
      return false;
    }

    const playerId = 'player-' + Date.now();
    State.playerId = playerId;
    State.playerRole = 'joueur';

    const player = { id: playerId, name: playerName || 'Aventurier', role: 'joueur', online: true };
    roomData.players.push(player);
    try { localStorage.setItem('co-room-' + clean, JSON.stringify(roomData)); } catch(_) {}

    this.room = roomData;
    PlayerManager.upsertPlayer({ ...player, color: '#7c4dff' });

    this._applyPlayerMode();
    this._updateSessionIndicator(true);

    showToast(`Rejoint la salle de ${roomData.gmName}`, 'success', '🔗');
    updateLog(`Connecté à la salle ${clean}`);
    return true;
  },

  /** Ferme la salle (MJ seulement). */
  closeRoom() {
    if (!this.room) return;
    try { localStorage.removeItem('co-room-' + this.room.code); } catch(_) {}
    this.room = null;
    State.playerRole = 'mj';
    this._applyGMMode();
    this._renderRoomPanel(false);
    this._updateSessionIndicator(false);
    showToast('Salle fermée', 'info', '🌐');
    updateLog('Salle fermée');
  },

  /** Assigne un token à un joueur. */
  assignToken(playerId, tokenId) {
    if (!this.room) return;
    const player = this.room.players.find(p => p.id === playerId);
    if (player) {
      player.controlledTokenId = tokenId;
      try { localStorage.setItem('co-room-' + this.room.code, JSON.stringify(this.room)); } catch(_) {}
      this._renderRoomPanel();
      showToast('Personnage assigné', 'success', '♟');
    }
  },

  /** Retourne le token contrôlé par le joueur actuel. */
  getMyToken() {
    if (!this.room) return null;
    const me = this.room.players.find(p => p.id === State.playerId);
    return me ? (me.controlledTokenId || null) : null;
  },

  // ── Affichage ────────────────────────────────────────────────────
  _renderRoomPanel(active = true) {
    const soloView = $('mp-solo-view');
    const roomView = $('mp-room-view');
    if (!soloView || !roomView) return;

    if (!active || !this.room) {
      soloView.style.display = 'block';
      roomView.style.display = 'none';
      return;
    }

    soloView.style.display = 'none';
    roomView.style.display = 'block';

    const codeEl = $('mp-room-code');
    if (codeEl) codeEl.textContent = this.room.code;

    this._renderPlayersList();
  },

  _renderPlayersList() {
    const list = $('mp-players-list');
    if (!list || !this.room) return;
    list.innerHTML = '';
    this.room.players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'mp-player-row';
      const dotClass = p.role === 'mj' ? 'mj' : (p.online ? '' : 'offline');
      const roleLabel = p.role === 'mj' ? 'MJ' : 'Joueur';
      const tokenToken = State.tokens.find(t => t.id === p.controlledTokenId);
      const tokenInfo = tokenToken ? ` · ${tokenToken.name}` : '';

      row.innerHTML = `
        <span class="mp-player-dot ${dotClass}"></span>
        <span class="mp-player-name">${p.name}</span>
        <span class="mp-player-role">${roleLabel}${tokenInfo}</span>
        ${State.playerRole === 'mj' && p.role !== 'mj' ? `<button class="mp-player-assign-btn" data-player-id="${p.id}">♟</button>` : ''}
      `;
      list.appendChild(row);
    });

    // Wire assign buttons
    list.querySelectorAll('.mp-player-assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.playerId;
        this._openAssignModal(pid);
      });
    });
  },

  _openAssignModal(playerId) {
    // Sélectionner un token via un picker simplifié (toast + clic prochain)
    if (!State.tokens.length) {
      showToast('Aucun pion sur la carte', 'warning', '⚠');
      return;
    }
    const player = this.room.players.find(p => p.id === playerId);
    const names = State.tokens.map(t => t.name).join(', ');
    showToast(`Cliquer sur un pion pour l'assigner à ${player?.name}`, 'info', '♟');
    // Écouter le prochain clic sur un token
    const handler = (e) => {
      const tokenEl = e.target.closest('.vtt-token');
      if (!tokenEl) return;
      const tokenId = tokenEl.dataset.tokenId;
      this.assignToken(playerId, tokenId);
      document.removeEventListener('mousedown', handler, true);
    };
    document.addEventListener('mousedown', handler, true);
  },

  _updateSessionIndicator(online) {
    const dot = document.querySelector('.session-dot');
    const text = document.querySelector('.session-text');
    if (!dot || !text) return;
    if (online && this.room) {
      dot.classList.add('online');
      text.textContent = this.room.code;
    } else {
      dot.classList.remove('online');
      text.textContent = 'Solo';
    }
  },

  // ── Application des modes ─────────────────────────────────────────
  _applyGMMode() {
    document.body.classList.remove('player-mode');
    // Cacher le HUD joueur
    const hud = $('player-hud');
    if (hud) hud.classList.add('hidden');
    // Afficher topbar/toolbar normaux
    const topbar = $('topbar');
    if (topbar) topbar.style.display = '';
    const toolbar = $('toolbar-left');
    if (toolbar) toolbar.style.display = '';
    const footer = $('action-bar');
    if (footer) footer.style.display = '';
  },

  _applyPlayerMode() {
    document.body.classList.add('player-mode');
    // Afficher le HUD joueur
    const hud = $('player-hud');
    if (hud) {
      hud.classList.remove('hidden');
      const campEl = $('player-hud-campaign');
      if (campEl) campEl.textContent = this.room?.name || State.campaignName;
      const codeEl = $('player-hud-code');
      if (codeEl) codeEl.textContent = this.room?.code || '—';
    }
    // Masquer outils MJ dans la toolbar
    document.querySelectorAll('.gm-only').forEach(el => {
      el.classList.add('gm-only-hidden');
    });
  },
};

// ═════════════════════════════════════════════════════════════════════════
//  PHASE 3.1 — MARKER MANAGER
//  Marqueurs temporaires visuels (⚔ ! ? 📍) — durée 3 secondes
// ═════════════════════════════════════════════════════════════════════════
const MarkerManager = {
  TYPES: ['⚔', '!', '?', '📍'],
  _markers: [],

  /** Place un marqueur en coordonnées monde (px). */
  place(worldX, worldY, type) {
    const layer = $('markers-layer');
    if (!layer) return;

    const el = document.createElement('div');
    el.className = 'vtt-marker';
    el.textContent = type;
    el.style.left = worldX + 'px';
    el.style.top  = worldY + 'px';
    layer.appendChild(el);

    const marker = { el, type, worldX, worldY, createdAt: Date.now(), duration: 3000 };
    this._markers.push(marker);

    // SyncManager : les autres joueurs verront ce marqueur (Phase 3.2 réseau)
    SyncManager.emit('markerPlaced', { worldX, worldY, type, playerId: State.playerId });

    // Auto-suppression après 3 secondes
    setTimeout(() => {
      el.remove();
      this._markers = this._markers.filter(m => m !== marker);
    }, marker.duration);
  },

  /** Reçoit un marqueur d'un autre joueur (via SyncManager). */
  receive(worldX, worldY, type) {
    this.place(worldX, worldY, type);
  },
};

// ═════════════════════════════════════════════════════════════════════════
//  PHASE 3.1 — SETUP MULTIJOUEUR UI
// ═════════════════════════════════════════════════════════════════════════
function setupMultiplayer() {
  // ── Boutons panneau MJ ─────────────────────────────────────────────
  $('btn-create-room')?.addEventListener('click', () => openModal('modal-create-room'));
  $('btn-join-room')?.addEventListener('click', () => openModal('modal-join-room'));
  $('btn-close-room')?.addEventListener('click', () => {
    if (confirm('Fermer la salle ? Tous les joueurs seront déconnectés.')) {
      RoomManager.closeRoom();
    }
  });
  $('btn-copy-code')?.addEventListener('click', () => {
    const code = $('mp-room-code')?.textContent;
    if (code && code !== '—') {
      navigator.clipboard?.writeText(code).catch(() => {});
      showToast(`Code copié : ${code}`, 'success', '📋');
    }
  });

  // ── Modal créer une salle ─────────────────────────────────────────
  $('btn-confirm-create-room')?.addEventListener('click', () => {
    const name = $('room-create-name')?.value.trim() || State.campaignName;
    const gmName = $('room-create-gm-name')?.value.trim() || 'Maître du Jeu';
    const max  = $('room-create-max-players')?.value || 4;
    RoomManager.createRoom(name, gmName, max);
    closeAllModals();
  });

  // ── Modal rejoindre une salle ─────────────────────────────────────
  $('btn-confirm-join-room')?.addEventListener('click', () => {
    const code = $('room-join-code')?.value.trim();
    const name = $('room-join-player-name')?.value.trim();
    const errEl = $('room-join-error');
    if (errEl) errEl.style.display = 'none';
    if (!code) { showToast('Entrez un code de salle', 'warning', '⚠'); return; }
    if (!name) { showToast('Entrez votre nom', 'warning', '⚠'); return; }
    const ok = RoomManager.joinRoom(code, name);
    if (ok) closeAllModals();
  });

  // ── Input code en majuscules automatique ─────────────────────────
  $('room-join-code')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // ── Marker Picker — clic droit sur la carte ───────────────────────
  _setupMarkerPicker();

  // ── SyncManager : écouter réception marqueurs distants ──────────
  SyncManager.on('markerPlaced', (payload) => {
    if (payload.playerId !== State.playerId) {
      MarkerManager.receive(payload.worldX, payload.worldY, payload.type);
    }
  });

  // ── Restriction déplacement joueur : seulement son propre token ──
  _setupPlayerTokenRestriction();

  // ── Marquer les éléments MJ uniquement dans le DOM ───────────────
  _markGMOnlyElements();
}

function _setupMarkerPicker() {
  // Créer le picker s'il n'existe pas
  let picker = $('marker-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'marker-picker';
    MarkerManager.TYPES.forEach(type => {
      const btn = document.createElement('button');
      btn.className = 'marker-pick-btn';
      btn.textContent = type;
      btn.title = `Placer ${type}`;
      picker.appendChild(btn);
    });
    document.body.appendChild(picker);
  }

  let _pickerTargetX = 0, _pickerTargetY = 0;

  // Clic droit sur la carte (pas en mode fog painting)
  $('map-viewport')?.addEventListener('contextmenu', (e) => {
    if (State.fogPainting) return; // Déjà géré par le brouillard
    if (e.target.closest('.vtt-token')) return;
    e.preventDefault();

    const { x, y } = screenToWorld(e.clientX, e.clientY);
    _pickerTargetX = x;
    _pickerTargetY = y;

    picker.style.left = (e.clientX - 80) + 'px';
    picker.style.top  = (e.clientY - 56) + 'px';
    picker.classList.add('visible');
  });

  // Clic sur un type de marqueur
  picker.querySelectorAll('.marker-pick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      MarkerManager.place(_pickerTargetX, _pickerTargetY, btn.textContent);
      picker.classList.remove('visible');
    });
  });

  // Fermer le picker si on clique ailleurs
  document.addEventListener('mousedown', (e) => {
    if (!picker.contains(e.target)) {
      picker.classList.remove('visible');
    }
  });
}

function _markGMOnlyElements() {
  // Les boutons de la toolbar réservés au MJ
  const gmSelectors = [
    '#btn-fog-panel',
    '#btn-tokens-panel',
    '#btn-scene-switcher',
    '#btn-settings',
    '#toolbar-left .toolbar-section:last-of-type', // Effets
    '#btn-roll-initiative',
    '#btn-end-turn',
    '#btn-next-round',
    '#panel-right',
  ];
  gmSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.classList.add('gm-only'));
  });
}

function _setupPlayerTokenRestriction() {
  // En mode joueur, intercepter le drag de token pour n'autoriser que son propre token
  // Cette fonction est appelée APRÈS setupTokenDrag — on surcharge la vérification
  const _originalSetupTokenDrag = window._originalSetupTokenDrag;

  // Hook sur l'événement mousedown capturé (Phase 3 : vérification de permission)
  document.addEventListener('mousedown', (e) => {
    if (State.playerRole !== 'joueur') return;
    const tokenEl = e.target.closest('.vtt-token');
    if (!tokenEl) return;
    const tokenId = tokenEl.dataset.tokenId;
    const myTokenId = RoomManager.getMyToken();
    if (myTokenId && tokenId !== myTokenId) {
      e.stopPropagation();
      showToast('Vous ne contrôlez pas ce personnage', 'warning', '⚠');
    }
  }, true);
}


// ═════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════
//  PHASE 3 COMPLÈTE — WEBSOCKET + CHAT + MARKERS + RECONNEXION
//  Greffé sur le moteur existant sans rien casser
// ═════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
//  WEBSOCKET ADAPTER — Remplace NetworkAdapter en mode réseau
// ─────────────────────────────────────────────────────────────────────────
const WebSocketAdapter = {
  _ws: null,
  _url: null,
  _connected: false,
  _reconnectTimer: null,
  _reconnectDelay: 2000,
  _maxDelay: 30000,
  _handlers: {},
  _pingInterval: null,

  /**
   * Connexion au serveur WebSocket.
   * L'URL doit pointer vers le serveur Node.js/WS.
   * Ex: ws://localhost:3000 ou wss://monserveur.com
   */
  connect(url) {
    this._url = url;
    this._doConnect();
  },

  _doConnect() {
    if (this._ws && (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN)) return;
    try {
      this._ws = new WebSocket(this._url);
      this._ws.onopen = () => this._onOpen();
      this._ws.onmessage = (e) => this._onMessage(e);
      this._ws.onclose = () => this._onClose();
      this._ws.onerror = (err) => this._onError(err);
    } catch (e) {
      console.warn('[WS] Connexion impossible:', e.message);
      this._scheduleReconnect();
    }
  },

  _onOpen() {
    this._connected = true;
    this._reconnectDelay = 2000;
    console.info('[WS] Connecté');
    // Restaurer la session si on était dans une salle
    if (RoomManager.room) {
      const room = RoomManager.room;
      this.send('REJOIN_ROOM', {
        roomCode: room.code,
        playerId: State.playerId,
        playerName: room.players.find(p => p.id === State.playerId)?.name || 'Joueur',
        role: State.playerRole,
      });
    }
    this._startPing();
    this._fire('connected', {});
  },

  _onMessage(e) {
    try {
      const msg = JSON.parse(e.data);
      if (!msg || !msg.type) return;
      this._fire(msg.type, msg.payload || {});
    } catch (err) {
      console.warn('[WS] Message invalide:', err);
    }
  },

  _onClose() {
    this._connected = false;
    this._stopPing();
    console.info('[WS] Déconnecté — tentative de reconnexion');
    this._fire('disconnected', {});
    this._scheduleReconnect();
  },

  _onError(err) {
    console.warn('[WS] Erreur:', err);
  },

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, this._maxDelay);
      this._doConnect();
    }, this._reconnectDelay);
  },

  _startPing() {
    clearInterval(this._pingInterval);
    this._pingInterval = setInterval(() => {
      if (this._connected) this.send('PING', {});
    }, 25000);
  },

  _stopPing() {
    clearInterval(this._pingInterval);
  },

  send(type, payload = {}) {
    if (!this._connected || !this._ws) return false;
    try {
      this._ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (e) {
      console.warn('[WS] Envoi échoué:', e);
      return false;
    }
  },

  on(type, handler) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(handler);
  },

  off(type, handler) {
    if (!this._handlers[type]) return;
    this._handlers[type] = this._handlers[type].filter(h => h !== handler);
  },

  _fire(type, payload) {
    const handlers = this._handlers[type] || [];
    handlers.forEach(h => { try { h(payload); } catch (e) { console.warn('[WS] Handler error:', e); } });
  },

  isConnected() { return this._connected; },
  disconnect() {
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingInterval);
    this._url = null;
    if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
    this._connected = false;
  },
};

// ─────────────────────────────────────────────────────────────────────────
//  NETWORK MANAGER — Orchestre le réseau (local ou WS)
// ─────────────────────────────────────────────────────────────────────────
const NetworkManager = {
  _mode: 'local', // 'local' | 'websocket'

  /** Active le mode WebSocket. Appeler avec l'URL du serveur. */
  useWebSocket(url) {
    this._mode = 'websocket';
    WebSocketAdapter.connect(url);
    this._bindServerEvents();
    console.info('[Network] Mode WebSocket activé:', url);
  },

  useLocal() {
    this._mode = 'local';
    WebSocketAdapter.disconnect();
    console.info('[Network] Mode local activé');
  },

  isMultiplayer() {
    return this._mode === 'websocket' && WebSocketAdapter.isConnected();
  },

  /** Envoie un événement au serveur (no-op en local). */
  emit(type, payload = {}) {
    if (this._mode === 'local') return;
    WebSocketAdapter.send(type, payload);
  },

  /** Gère tous les événements entrants du serveur. */
  _bindServerEvents() {
    // Connexion
    WebSocketAdapter.on('connected', () => {
      _updateSessionDot('connecting');
    });

    WebSocketAdapter.on('disconnected', () => {
      _updateSessionDot('offline');
      showToast('Connexion perdue — reconnexion en cours...', 'warning', '📡');
    });

    // Réponses serveur CREATE/JOIN
    WebSocketAdapter.on('ROOM_CREATED', (data) => {
      if (!data.roomCode) return;
      RoomManager.room.code = data.roomCode;
      RoomManager.room.id = data.roomId || RoomManager.room.id;
      RoomManager._renderRoomPanel();
      RoomManager._updateSessionIndicator(true);
      _updateSessionDot('online');
      showToast(`Salle créée : ${data.roomCode}`, 'success', '🌐');
    });

    WebSocketAdapter.on('ROOM_JOINED', (data) => {
      if (!data.snapshot) return;
      _applyServerSnapshot(data.snapshot);
      RoomManager._updateSessionIndicator(true);
      _updateSessionDot('online');
      showToast(`Salle rejointe !`, 'success', '🔗');
    });

    WebSocketAdapter.on('ROOM_ERROR', (data) => {
      const msg = data.message || 'Erreur de salle';
      showToast(msg, 'warning', '⚠');
      const errEl = $('room-join-error');
      if (errEl) { errEl.textContent = '⚠ ' + msg; errEl.style.display = 'block'; }
    });

    // Snapshot complet (après reconnexion ou demande)
    WebSocketAdapter.on('SNAPSHOT', (data) => {
      if (data.snapshot) _applyServerSnapshot(data.snapshot);
    });

    // Joueurs
    WebSocketAdapter.on('PLAYER_JOINED', (data) => {
      if (!data.player || !RoomManager.room) return;
      const exists = RoomManager.room.players.find(p => p.id === data.player.id);
      if (!exists) RoomManager.room.players.push({ ...data.player, online: true });
      else exists.online = true;
      RoomManager._renderPlayersList();
      showToast(`${data.player.name} a rejoint la partie`, 'info', '👤');
    });

    WebSocketAdapter.on('PLAYER_LEFT', (data) => {
      if (!RoomManager.room) return;
      const p = RoomManager.room.players.find(p => p.id === data.playerId);
      if (p) p.online = false;
      RoomManager._renderPlayersList();
      if (p) showToast(`${p.name} s'est déconnecté`, 'info', '👤');
    });

    // Tokens
    WebSocketAdapter.on('TOKEN_MOVED', (data) => {
      if (!data.tokenId) return;
      if (data.playerId === State.playerId) return; // Ignorer ses propres mises à jour
      const t = State.tokens.find(t => t.id === data.tokenId);
      if (t) {
        t.x = data.x; t.y = data.y;
        const sizePx = State.gridCellSize * t.size;
        const el = $('token-el-' + data.tokenId);
        if (el) { el.style.left = (data.x - sizePx/2) + 'px'; el.style.top = (data.y - sizePx/2) + 'px'; }
      }
    });

    WebSocketAdapter.on('TOKEN_UPSERTED', (data) => {
      if (!data.token || data.playerId === State.playerId) return;
      const existing = State.tokens.find(t => t.id === data.token.id);
      if (existing) {
        Object.assign(existing, data.token);
        const el = $('token-el-' + data.token.id);
        if (el) { el.remove(); renderToken(existing); }
      } else {
        State.tokens.push(data.token);
        renderToken(data.token);
        updateInfoDisplay();
      }
    });

    WebSocketAdapter.on('TOKEN_DELETED', (data) => {
      if (!data.tokenId || data.playerId === State.playerId) return;
      const el = $('token-el-' + data.tokenId);
      if (el) el.remove();
      State.tokens = State.tokens.filter(t => t.id !== data.tokenId);
      updateInfoDisplay();
    });

    WebSocketAdapter.on('TOKEN_OWNER_ASSIGNED', (data) => {
      const t = State.tokens.find(t => t.id === data.tokenId);
      if (t) t.ownerPlayerId = data.ownerPlayerId;
      if (RoomManager.room) {
        const p = RoomManager.room.players.find(p => p.id === data.ownerPlayerId);
        if (p) p.controlledTokenId = data.tokenId;
        RoomManager._renderPlayersList();
      }
    });

    // Scène
    WebSocketAdapter.on('SCENE_CHANGED', (data) => {
      if (!data.sceneId || data.playerId === State.playerId) return;
      const scene = State.scenes.find(s => s.id === data.sceneId);
      if (scene) {
        loadScene(scene);
        showToast(`Le MJ a changé de scène : ${scene.name}`, 'info', '🗺');
      }
    });

    // Fog
    WebSocketAdapter.on('FOG_UPDATED', (data) => {
      if (!data.fogData || data.playerId === State.playerId) return;
      State.fogData = data.fogData;
      State.fogEnabled = data.fogEnabled !== undefined ? data.fogEnabled : State.fogEnabled;
      applyFogVisibility();
      redrawFogCanvas();
    });

    // Combat
    WebSocketAdapter.on('COMBAT_UPDATED', (data) => {
      if (data.playerId === State.playerId) return;
      if (data.initiativeOrder !== undefined) State.initiativeOrder = data.initiativeOrder;
      if (data.currentTurn !== undefined) State.currentTurn = data.currentTurn;
      if (data.round !== undefined) State.round = data.round;
      if (data.combatActive !== undefined) State.combatActive = data.combatActive;
      renderInitiativeTrack();
      const rnEl = $('round-number'); if (rnEl) rnEl.textContent = State.round || '—';
      const irEl = $('info-round'); if (irEl) irEl.textContent = State.round || '—';
    });

    // Chat
    WebSocketAdapter.on('CHAT_MESSAGE', (data) => {
      if (!data.message) return;
      ChatManager.receiveMessage(data.message);
    });

    // Markers
    WebSocketAdapter.on('MARKER_PLACED', (data) => {
      if (!data.marker || data.marker.placedBy === State.playerId) return;
      MarkerManager.receiveRemote(data.marker);
    });

    WebSocketAdapter.on('MARKER_REMOVED', (data) => {
      if (!data.markerId) return;
      MarkerManager.removeById(data.markerId);
    });

    // HP token sync
    WebSocketAdapter.on('TOKEN_HP_UPDATED', (data) => {
      if (!data.tokenId || data.playerId === State.playerId) return;
      const t = State.tokens.find(t => t.id === data.tokenId);
      if (!t) return;
      t.hp = data.hp;
      const fill = $('hp-fill-' + data.tokenId);
      if (fill) updateHpFill(fill, t.hp, t.hpMax);
      if (State.selectedTokenId === data.tokenId) {
        const tipFill = $('tip-hp-fill'); if (tipFill) updateHpFill(tipFill, t.hp, t.hpMax);
        const tipText = $('tip-hp-text'); if (tipText) tipText.textContent = `${t.hp}/${t.hpMax}`;
      }
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────
//  APPLY SERVER SNAPSHOT — Restaure l'état depuis le serveur
// ─────────────────────────────────────────────────────────────────────────
function _applyServerSnapshot(snapshot) {
  if (!snapshot) return;

  // Joueurs
  if (snapshot.players && RoomManager.room) {
    RoomManager.room.players = snapshot.players;
    // Appliquer ownerPlayerId depuis les assignments
    snapshot.players.forEach(p => {
      if (p.controlledTokenId) {
        const t = State.tokens.find(t => t.id === p.controlledTokenId);
        if (t) t.ownerPlayerId = p.id;
      }
    });
    RoomManager._renderPlayersList();
  }

  // Scène
  if (snapshot.currentSceneId && snapshot.currentSceneId !== State.currentSceneId) {
    const scene = State.scenes.find(s => s.id === snapshot.currentSceneId);
    if (scene) loadScene(scene);
  }

  // Tokens
  if (snapshot.tokens) {
    // Fusionner en conservant les images locales
    snapshot.tokens.forEach(serverToken => {
      const local = State.tokens.find(t => t.id === serverToken.id);
      if (local) {
        const imgData = local.imgData; // Conserver l'image locale
        Object.assign(local, serverToken);
        if (imgData && !local.imgData) local.imgData = imgData;
        const el = $('token-el-' + serverToken.id);
        if (el) { el.remove(); renderToken(local); }
      } else {
        State.tokens.push(serverToken);
        renderToken(serverToken);
      }
    });
    // Supprimer les tokens qui ne sont plus sur le serveur
    const serverIds = new Set(snapshot.tokens.map(t => t.id));
    State.tokens = State.tokens.filter(t => {
      if (!serverIds.has(t.id)) {
        const el = $('token-el-' + t.id);
        if (el) el.remove();
        return false;
      }
      return true;
    });
    updateInfoDisplay();
  }

  // Fog
  if (snapshot.fogData !== undefined) {
    State.fogData = snapshot.fogData || {};
    State.fogEnabled = snapshot.fogEnabled || false;
    applyFogVisibility();
    redrawFogCanvas();
  }

  // Combat
  if (snapshot.combatActive !== undefined) {
    State.combatActive = snapshot.combatActive;
    State.initiativeOrder = snapshot.initiativeOrder || [];
    State.currentTurn = snapshot.currentTurn || 0;
    State.round = snapshot.round || 0;
    renderInitiativeTrack();
    const rnEl = $('round-number'); if (rnEl) rnEl.textContent = State.round || '—';
    const irEl = $('info-round'); if (irEl) irEl.textContent = State.round || '—';
  }

  // Chat
  if (snapshot.chatMessages) {
    ChatManager.loadHistory(snapshot.chatMessages);
  }

  console.info('[Snapshot] Appliqué:', Object.keys(snapshot).join(', '));
}

// ─────────────────────────────────────────────────────────────────────────
//  SESSION DOT — Indicateur visuel de connexion
// ─────────────────────────────────────────────────────────────────────────
function _updateSessionDot(status) {
  const dot = document.querySelector('.session-dot');
  if (!dot) return;
  dot.classList.remove('online', 'offline', 'connecting');
  if (status === 'online') dot.classList.add('online');
  else if (status === 'connecting') dot.classList.add('connecting');
}

// ─────────────────────────────────────────────────────────────────────────
//  CHAT MANAGER — Chat temps réel complet
// ─────────────────────────────────────────────────────────────────────────
const ChatManager = {
  messages: [],
  _panelVisible: false,
  _unread: 0,

  init() {
    this._createPanel();
    this._bindToggle();
  },

  _createPanel() {
    if ($('chat-panel')) return;

    // Bouton toggle dans la footer/action-bar
    const chatToggleBtn = document.createElement('button');
    chatToggleBtn.id = 'chat-toggle-btn';
    chatToggleBtn.className = 'action-btn';
    chatToggleBtn.title = 'Ouvrir le chat (C)';
    chatToggleBtn.innerHTML = '<span>💬</span><small>Chat</small>';
    chatToggleBtn.style.position = 'relative';
    const actionCenter = document.querySelector('.action-center');
    if (actionCenter) actionCenter.appendChild(chatToggleBtn);

    // Panel chat
    const panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:80px',
      'width:320px',
      'height:380px',
      'display:flex',
      'flex-direction:column',
      'background:rgba(10,8,22,0.97)',
      'border:1px solid rgba(201,168,76,0.22)',
      'border-radius:14px',
      'box-shadow:0 16px 48px rgba(0,0,0,0.55)',
      'z-index:300',
      'overflow:hidden',
      'transform:translateY(20px)',
      'opacity:0',
      'pointer-events:none',
      'transition:transform 0.2s ease,opacity 0.2s ease',
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(201,168,76,0.06);">
        <span style="font-family:Cinzel,serif;color:#e8c97a;font-size:0.9rem;font-weight:600;">💬 Chat de Partie</span>
        <button id="chat-close-btn" style="background:transparent;color:#9e8c6a;font-size:16px;border:none;cursor:pointer;padding:2px 6px;">✕</button>
      </div>
      <div id="chat-messages" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:7px;scroll-behavior:smooth;"></div>
      <div style="padding:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:8px;">
        <input id="chat-input" type="text" maxlength="300" placeholder="Message…"
          style="flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.22);border-radius:8px;padding:8px 11px;color:#e8dfc0;font-family:Crimson Text,serif;font-size:0.9rem;outline:none;" />
        <button id="chat-send-btn" style="padding:8px 13px;border-radius:8px;background:rgba(201,168,76,0.16);border:1px solid rgba(201,168,76,0.28);color:#e8c97a;cursor:pointer;font-size:14px;">↵</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Events du panel
    $('chat-close-btn')?.addEventListener('click', () => this.toggle(false));
    $('chat-send-btn')?.addEventListener('click', () => this._sendFromInput());
    $('chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendFromInput(); }
    });
  },

  _bindToggle() {
    const btn = $('chat-toggle-btn');
    if (btn) btn.addEventListener('click', () => this.toggle());

    // Raccourci C
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.key.toLowerCase() === 'c') this.toggle();
    });
  },

  toggle(force) {
    const panel = $('chat-panel');
    if (!panel) return;
    const show = force !== undefined ? force : !this._panelVisible;
    this._panelVisible = show;
    if (show) {
      panel.style.transform = 'translateY(0)';
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      this._unread = 0;
      this._updateBadge(0);
      setTimeout(() => {
        const msgs = $('chat-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
        $('chat-input')?.focus();
      }, 50);
    } else {
      panel.style.transform = 'translateY(20px)';
      panel.style.opacity = '0';
      panel.style.pointerEvents = 'none';
    }
  },

  _sendFromInput() {
    const input = $('chat-input');
    const text = input?.value?.trim();
    if (!text) return;
    input.value = '';
    this.sendMessage(text);
  },

  sendMessage(text) {
    const message = {
      id: 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 99999),
      playerId: State.playerId,
      authorName: RoomManager.room?.players.find(p => p.id === State.playerId)?.name || 'MJ',
      role: State.playerRole,
      text,
      timestamp: Date.now(),
    };

    // En mode réseau, envoyer au serveur
    if (NetworkManager.isMultiplayer()) {
      NetworkManager.emit('SEND_CHAT', { text, playerId: State.playerId });
    } else {
      // En solo ou local : ajouter directement
      this.receiveMessage(message);
    }
  },

  receiveMessage(message) {
    // Éviter les doublons
    if (this.messages.find(m => m.id === message.id)) return;
    this.messages.push(message);
    // Garder 100 messages max
    if (this.messages.length > 100) this.messages = this.messages.slice(-100);
    this._appendMessageDOM(message);
    if (!this._panelVisible) {
      this._unread++;
      this._updateBadge(this._unread);
    }
  },

  loadHistory(messages) {
    if (!Array.isArray(messages)) return;
    this.messages = [];
    const container = $('chat-messages');
    if (container) container.innerHTML = '';
    messages.forEach(m => this.receiveMessage(m));
  },

  _appendMessageDOM(message) {
    const container = $('chat-messages');
    if (!container) return;
    const isMine = message.playerId === State.playerId;
    const isMJ = message.role === 'mj';

    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 11px',
      'border-radius:10px',
      `background:${isMine ? 'rgba(124,77,255,0.18)' : 'rgba(255,255,255,0.04)'}`,
      `border:1px solid ${isMine ? 'rgba(124,77,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
      'animation:chat-in 0.15s ease',
    ].join(';');

    const time = new Date(message.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nameColor = isMJ ? '#e8c97a' : '#b39dff';
    const roleLabel = isMJ ? '⚔ MJ' : '🧙 Joueur';

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;">
        <strong style="font-size:0.76rem;color:${nameColor};font-family:Cinzel,serif;">${_escapeHtml(message.authorName)} · ${roleLabel}</strong>
        <span style="font-size:0.68rem;color:#5a4a2a;white-space:nowrap;">${time}</span>
      </div>
      <div style="font-size:0.85rem;color:#e8dfc0;white-space:pre-wrap;word-break:break-word;line-height:1.45;">${_escapeHtml(message.text)}</div>
    `;

    container.appendChild(div);
    // Auto-scroll
    container.scrollTop = container.scrollHeight;
  },

  _updateBadge(count) {
    const btn = $('chat-toggle-btn');
    if (!btn) return;
    let badge = btn.querySelector('.chat-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-badge';
        badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#c0392b;color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:700;';
        btn.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : count;
    } else if (badge) {
      badge.remove();
    }
  },
};

function _escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────────────────────
//  MARKER MANAGER V2 — Marqueurs synchronisés complets
// ─────────────────────────────────────────────────────────────────────────
const MarkerManagerV2 = {
  _markers: new Map(), // id → { el, timerId }
  SYMBOLS: ['❗', '⚔', '👁', '☠', '✦', '?', '!', '📍'],
  DURATION: 3000,

  init() {
    this._ensureStyles();
    this._setupContextMenu();
  },

  place(worldX, worldY, symbol, playerId = null) {
    const marker = {
      id: 'mk-' + Date.now() + '-' + Math.floor(Math.random() * 99999),
      x: worldX,
      y: worldY,
      symbol,
      placedBy: playerId || State.playerId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.DURATION,
    };

    this._renderMarker(marker);

    // Sync réseau
    if (NetworkManager.isMultiplayer()) {
      NetworkManager.emit('PLACE_MARKER', { marker });
    }

    // Auto-remove
    const timerId = setTimeout(() => this.removeById(marker.id), this.DURATION);
    this._markers.get(marker.id).timerId = timerId;

    return marker;
  },

  receiveRemote(marker) {
    if (this._markers.has(marker.id)) return;
    this._renderMarker(marker);
    const remaining = Math.max(100, (marker.expiresAt || Date.now() + this.DURATION) - Date.now());
    const timerId = setTimeout(() => this.removeById(marker.id), remaining);
    if (this._markers.has(marker.id)) this._markers.get(marker.id).timerId = timerId;
  },

  _renderMarker(marker) {
    const layer = $('markers-layer');
    if (!layer) return;

    const el = document.createElement('div');
    el.className = 'vtt-marker v2';
    el.dataset.markerId = marker.id;
    el.textContent = marker.symbol;
    el.style.cssText = [
      'position:absolute',
      `left:${marker.x}px`,
      `top:${marker.y}px`,
      'transform:translate(-50%,-50%)',
      'font-size:30px',
      'pointer-events:none',
      'text-shadow:0 0 20px rgba(255,255,255,0.6)',
      'animation:marker-pop-v2 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      'z-index:50',
    ].join(';');
    layer.appendChild(el);

    this._markers.set(marker.id, { el, timerId: null });
  },

  removeById(id) {
    const entry = this._markers.get(id);
    if (!entry) return;
    clearTimeout(entry.timerId);
    if (entry.el && entry.el.parentNode) {
      entry.el.style.animation = 'marker-fade-v2 0.2s ease forwards';
      setTimeout(() => entry.el?.remove(), 200);
    }
    this._markers.delete(id);
  },

  _setupContextMenu() {
    // Remplacer l'ancien picker si existant
    let picker = $('marker-picker-v2');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'marker-picker-v2';
      picker.style.cssText = [
        'position:fixed',
        'display:none',
        'gap:6px',
        'padding:8px 10px',
        'background:rgba(10,8,22,0.96)',
        'border:1px solid rgba(201,168,76,0.22)',
        'border-radius:12px',
        'z-index:500',
        'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
        'flex-wrap:wrap',
        'max-width:220px',
      ].join(';');

      this.SYMBOLS.forEach(sym => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = sym;
        btn.style.cssText = 'width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);font-size:19px;cursor:pointer;transition:background 0.15s;';
        btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(201,168,76,0.18)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255,255,255,0.05)');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wx = parseFloat(picker.dataset.wx || 0);
          const wy = parseFloat(picker.dataset.wy || 0);
          this.place(wx, wy, sym);
          this._hidePicker();
        });
        picker.appendChild(btn);
      });
      document.body.appendChild(picker);
    }

    let _pendingClose = null;
    const vp = $('map-viewport');
    vp?.addEventListener('contextmenu', (e) => {
      if (State.fogPainting) return;
      if (e.target.closest('.vtt-token')) return;
      e.preventDefault();
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      picker.dataset.wx = x;
      picker.dataset.wy = y;
      picker.style.display = 'flex';
      picker.style.left = Math.min(e.clientX - 80, window.innerWidth - 240) + 'px';
      picker.style.top = Math.max(e.clientY - 56, 8) + 'px';
      clearTimeout(_pendingClose);
    });

    document.addEventListener('mousedown', (e) => {
      if (!picker.contains(e.target)) this._hidePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hidePicker();
    });
  },

  _hidePicker() {
    const picker = $('marker-picker-v2');
    if (picker) picker.style.display = 'none';
  },

  _ensureStyles() {
    if ($('marker-v2-styles')) return;
    const style = document.createElement('style');
    style.id = 'marker-v2-styles';
    style.textContent = `
      @keyframes marker-pop-v2 {
        from { transform: translate(-50%,-50%) scale(0.4); opacity: 0; }
        to   { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
      }
      @keyframes marker-fade-v2 {
        from { transform: translate(-50%,-50%) scale(1); opacity: 1; }
        to   { transform: translate(-50%,-50%) scale(0.4); opacity: 0; }
      }
      @keyframes chat-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .session-dot.connecting {
        animation: dot-pulse 1s infinite;
        background: #f39c12 !important;
      }
      @keyframes dot-pulse {
        0%, 100% { opacity: 1; } 50% { opacity: 0.3; }
      }
    `;
    document.head.appendChild(style);
  },
};

// ─────────────────────────────────────────────────────────────────────────
//  HOOKS SUR LES ACTIONS EXISTANTES — Branchement réseau
//  On enveloppe les fonctions existantes pour ajouter la synchro
// ─────────────────────────────────────────────────────────────────────────
function _installNetworkHooks() {

  // ── moveTokenEl : émettre après snap final ───────────────────────────
  const _origMoveTokenEl = moveTokenEl;
  window.moveTokenEl = function(id, worldX, worldY, doSnap) {
    _origMoveTokenEl(id, worldX, worldY, doSnap);
    if (doSnap && NetworkManager.isMultiplayer()) {
      const t = State.tokens.find(t => t.id === id);
      if (t) {
        NetworkManager.emit('MOVE_TOKEN', {
          tokenId: id,
          x: t.x,
          y: t.y,
          playerId: State.playerId,
        });
      }
    }
  };

  // ── adjustHP : synchroniser les PV ──────────────────────────────────
  const _origAdjustHP = adjustHP;
  window.adjustHP = function(id, delta) {
    _origAdjustHP(id, delta);
    if (NetworkManager.isMultiplayer()) {
      const t = State.tokens.find(t => t.id === id);
      if (t) {
        NetworkManager.emit('UPDATE_TOKEN_HP', {
          tokenId: id,
          hp: t.hp,
          playerId: State.playerId,
        });
      }
    }
  };

  // ── saveTokenFromModal : synchroniser création/édition ──────────────
  const _origSaveToken = saveTokenFromModal;
  window.saveTokenFromModal = function() {
    const editId = $('token-edit-id')?.value;
    const prevCount = State.tokens.length;
    _origSaveToken();
    if (!NetworkManager.isMultiplayer()) return;
    // Vérifier si un token a été créé ou modifié
    setTimeout(() => {
      if (!editId) {
        // Nouveau token
        const newToken = State.tokens[State.tokens.length - 1];
        if (newToken && State.tokens.length > prevCount) {
          NetworkManager.emit('UPSERT_TOKEN', {
            token: { ...newToken, imgData: undefined, hasImg: !!newToken.imgData },
            playerId: State.playerId,
          });
        }
      } else {
        // Token édité
        const t = State.tokens.find(t => t.id === editId);
        if (t) {
          NetworkManager.emit('UPSERT_TOKEN', {
            token: { ...t, imgData: undefined, hasImg: !!t.imgData },
            playerId: State.playerId,
          });
        }
      }
    }, 50);
  };

  // ── deleteToken : synchroniser suppression ───────────────────────────
  const _origDeleteToken = deleteToken;
  window.deleteToken = function(id) {
    _origDeleteToken(id);
    if (NetworkManager.isMultiplayer()) {
      NetworkManager.emit('DELETE_TOKEN', { tokenId: id, playerId: State.playerId });
    }
  };

  // ── loadScene : synchroniser changement de scène (MJ seulement) ─────
  const _origLoadScene = loadScene;
  window.loadScene = function(scene) {
    _origLoadScene(scene);
    if (NetworkManager.isMultiplayer() && State.playerRole === 'mj') {
      NetworkManager.emit('CHANGE_SCENE', { sceneId: scene.id, playerId: State.playerId });
    }
  };

  // ── paintFogCells : synchroniser brouillard (debounced) ──────────────
  let _fogSyncTimer = null;
  const _origPaintFog = paintFogCells;
  window.paintFogCells = function(worldX, worldY) {
    _origPaintFog(worldX, worldY);
    if (NetworkManager.isMultiplayer() && State.playerRole === 'mj') {
      clearTimeout(_fogSyncTimer);
      _fogSyncTimer = setTimeout(() => {
        NetworkManager.emit('UPDATE_FOG', {
          fogData: State.fogData,
          fogEnabled: State.fogEnabled,
          playerId: State.playerId,
        });
      }, 500);
    }
  };

  // ── fogRevealAll / fogHideAll ─────────────────────────────────────────
  const _origFogReveal = fogRevealAll;
  window.fogRevealAll = function() {
    _origFogReveal();
    if (NetworkManager.isMultiplayer() && State.playerRole === 'mj') {
      NetworkManager.emit('UPDATE_FOG', { fogData: State.fogData, fogEnabled: State.fogEnabled, playerId: State.playerId });
    }
  };

  const _origFogHide = fogHideAll;
  window.fogHideAll = function() {
    _origFogHide();
    if (NetworkManager.isMultiplayer() && State.playerRole === 'mj') {
      NetworkManager.emit('UPDATE_FOG', { fogData: State.fogData, fogEnabled: State.fogEnabled, playerId: State.playerId });
    }
  };

  // ── CombatManager.launchWithSelected ────────────────────────────────
  const _origLaunch = CombatManager.launchWithSelected.bind(CombatManager);
  CombatManager.launchWithSelected = function() {
    _origLaunch();
    if (NetworkManager.isMultiplayer() && State.playerRole === 'mj') {
      NetworkManager.emit('UPDATE_COMBAT', {
        combatActive: State.combatActive,
        initiativeOrder: State.initiativeOrder,
        currentTurn: State.currentTurn,
        round: State.round,
        playerId: State.playerId,
      });
    }
  };

  const _origEndCombat = CombatManager.endCombat.bind(CombatManager);
  CombatManager.endCombat = function() {
    _origEndCombat();
    if (NetworkManager.isMultiplayer() && State.playerRole === 'mj') {
      NetworkManager.emit('UPDATE_COMBAT', {
        combatActive: false,
        initiativeOrder: [],
        currentTurn: 0,
        round: 0,
        playerId: State.playerId,
      });
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  ROOM MANAGER V2 — Surcharge pour WebSocket réel
// ─────────────────────────────────────────────────────────────────────────
function _upgradeRoomManagerForWS() {
  // Surcharge createRoom pour utiliser WS si configuré
  const _origCreateRoom = RoomManager.createRoom.bind(RoomManager);
  RoomManager.createRoom = function(name, gmName, maxPlayers) {
    const room = _origCreateRoom(name, gmName, maxPlayers);
    if (NetworkManager._mode === 'websocket') {
      // Tenter de créer la salle côté serveur
      NetworkManager.emit('CREATE_ROOM', {
        playerName: gmName || 'Maître du Jeu',
        playerId: State.playerId,
        maxPlayers: parseInt(maxPlayers, 10) || 4,
        initialState: {
          tokens: State.tokens.map(t => ({ ...t, imgData: undefined })),
          currentSceneId: State.currentSceneId,
          fogData: State.fogData,
          fogEnabled: State.fogEnabled,
        },
      });
      _updateSessionDot('connecting');
    }
    return room;
  };

  const _origJoinRoom = RoomManager.joinRoom.bind(RoomManager);
  RoomManager.joinRoom = function(code, playerName) {
    if (NetworkManager._mode === 'websocket') {
      // Via WebSocket : mode d'attente
      State.playerId = State.playerId || ('player-' + Date.now());
      State.playerRole = 'joueur';
      NetworkManager.emit('JOIN_ROOM', {
        roomCode: code.toUpperCase().trim(),
        playerName: playerName || 'Aventurier',
        playerId: State.playerId,
      });
      // Créer une room temporaire pour l'UI
      this.room = {
        id: 'room-pending',
        code: code.toUpperCase().trim(),
        name: '...',
        players: [{ id: State.playerId, name: playerName, role: 'joueur', online: true }],
        maxPlayers: 4,
      };
      PlayerManager.upsertPlayer({ id: State.playerId, name: playerName, role: 'joueur', color: '#7c4dff' });
      this._applyPlayerMode();
      _updateSessionDot('connecting');
      return true;
    }
    return _origJoinRoom(code, playerName);
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  PERMISSION UI — Masquer les contrôles selon le rôle
// ─────────────────────────────────────────────────────────────────────────
function _refreshPermissionUI() {
  const isMJ = State.playerRole === 'mj';
  const gmOnlyItems = [
    '#btn-fog-panel', '#btn-tokens-panel', '#btn-scene-switcher',
    '#btn-settings', '#btn-roll-initiative', '#btn-next-round',
    '#panel-right', '#toolbar-left .toolbar-section:last-of-type',
  ];
  gmOnlyItems.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (!isMJ) { el.style.opacity = '0.3'; el.style.pointerEvents = 'none'; }
      else { el.style.opacity = ''; el.style.pointerEvents = ''; }
    });
  });

  // Toujours visible pour les joueurs
  ['#btn-roll-dice', '#dice-grid', '#btn-end-turn'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.opacity = ''; el.style.pointerEvents = '';
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  WS SERVER CONFIG — Modale de configuration du serveur WebSocket
// ─────────────────────────────────────────────────────────────────────────
function _injectWSConfigPanel() {
  // Ajouter un lien "Serveur WS" dans le panneau multijoueur
  const mpSolo = $('mp-solo-view');
  if (!mpSolo || $('ws-config-panel')) return;

  const wsPanel = document.createElement('div');
  wsPanel.id = 'ws-config-panel';
  wsPanel.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);';
  wsPanel.innerHTML = `
    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-style:italic;">Serveur WebSocket (optionnel)</div>
    <div style="display:flex;gap:6px;">
      <input id="ws-url-input" type="text" class="fantasy-input" placeholder="ws://localhost:3000" value=""
        style="flex:1;padding:6px 9px;font-size:0.75rem;" />
      <button id="ws-connect-btn" class="btn-fantasy" style="padding:6px 10px;font-size:0.72rem;">⚡</button>
    </div>
    <div id="ws-status-text" style="font-size:0.7rem;margin-top:5px;color:var(--text-muted);">Non connecté</div>
  `;
  mpSolo.appendChild(wsPanel);

  $('ws-connect-btn')?.addEventListener('click', () => {
    const url = $('ws-url-input')?.value.trim();
    if (!url) return;
    $('ws-status-text').textContent = 'Connexion…';
    $('ws-status-text').style.color = '#f39c12';
    NetworkManager.useWebSocket(url);
    WebSocketAdapter.on('connected', () => {
      $('ws-status-text').textContent = '✓ Connecté';
      $('ws-status-text').style.color = '#27ae60';
    });
    WebSocketAdapter.on('disconnected', () => {
      $('ws-status-text').textContent = '✗ Déconnecté';
      $('ws-status-text').style.color = '#c0392b';
    });
  });

  // Pré-remplir depuis localStorage si déjà utilisé
  const savedUrl = localStorage.getItem('co-ws-url');
  if (savedUrl) {
    const input = $('ws-url-input');
    if (input) input.value = savedUrl;
  }
  $('ws-url-input')?.addEventListener('change', (e) => {
    localStorage.setItem('co-ws-url', e.target.value.trim());
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  PLAYER RESTRICTION V2 — Permissions token côté joueur
// ─────────────────────────────────────────────────────────────────────────
function _setupPlayerTokenPermission() {
  document.addEventListener('mousedown', (e) => {
    if (State.playerRole !== 'joueur') return;
    const tokenEl = e.target.closest('.vtt-token');
    if (!tokenEl) return;
    const tokenId = tokenEl.dataset.tokenId;
    const myTokenId = RoomManager.getMyToken();

    // Trouver le token par ownerPlayerId aussi
    const t = State.tokens.find(t => t.id === tokenId);
    const canControl = (myTokenId && tokenId === myTokenId) ||
                       (t && t.ownerPlayerId === State.playerId);

    if (!canControl) {
      e.stopPropagation();
      showToast('Ce personnage ne vous appartient pas', 'warning', '⚠');
    }
  }, true);
}

// ─────────────────────────────────────────────────────────────────────────
//  INIT PHASE 3 COMPLÈTE
// ─────────────────────────────────────────────────────────────────────────
function initPhase3Complete() {
  // 1. Installer les hooks réseau sur les actions existantes
  _installNetworkHooks();

  // 2. Upgrader RoomManager pour WS
  _upgradeRoomManagerForWS();

  // 3. Initialiser Chat
  ChatManager.init();

  // 4. Initialiser Markers V2
  MarkerManagerV2.init();

  // 5. Panel config WS
  _injectWSConfigPanel();

  // 6. Permission UI
  _setupPlayerTokenPermission();

  // 7. Sync SyncManager avec NetworkManager
  // (SyncManager.emit appelle NetworkAdapter.send — on redirige vers NetworkManager)
  NetworkAdapter.send = (event, payload) => {
    if (NetworkManager.isMultiplayer()) {
      NetworkManager.emit(event, payload);
    }
  };

  // 8. Écouter les changements de rôle pour rafraîchir l'UI
  const _origApplyGMMode = RoomManager._applyGMMode.bind(RoomManager);
  RoomManager._applyGMMode = function() {
    _origApplyGMMode();
    _refreshPermissionUI();
    showToast('Mode Maître du Jeu activé', 'success', '⚔');
  };
  const _origApplyPlayerMode = RoomManager._applyPlayerMode.bind(RoomManager);
  RoomManager._applyPlayerMode = function() {
    _origApplyPlayerMode();
    _refreshPermissionUI();
    showToast('Mode Joueur activé', 'info', '🧙');
  };

  // 9. Exposer l'API legacy pour le bridge externe si besoin
  window.__VTT_LEGACY__ = {
    screenToWorld,
    loadSceneById: (sceneId) => {
      const scene = State.scenes.find(s => s.id === sceneId);
      if (scene) loadScene(scene);
    },
    moveToken: moveTokenEl,
    upsertToken: (token) => {
      const existing = State.tokens.find(t => t.id === token.id);
      if (existing) {
        Object.assign(existing, token);
        const el = $('token-el-' + token.id);
        if (el) { el.remove(); renderToken(existing); }
      } else {
        State.tokens.push(token);
        renderToken(token);
      }
    },
    applyFogPatch: (patch) => {
      if (patch.fogData) State.fogData = patch.fogData;
      if (patch.fogEnabled !== undefined) State.fogEnabled = patch.fogEnabled;
      applyFogVisibility();
      redrawFogCanvas();
    },
    applyCombatPatch: (patch) => {
      Object.assign(State, patch);
      renderInitiativeTrack();
    },
    addChatMessage: (message) => ChatManager.receiveMessage(message),
    addMarker: (marker) => MarkerManagerV2.receiveRemote(marker),
    removeMarker: (id) => MarkerManagerV2.removeById(id),
    clearMarkers: () => MarkerManagerV2._markers.forEach((_, id) => MarkerManagerV2.removeById(id)),
    setMultiplayerSnapshot: _applyServerSnapshot,
    getState: () => State,
    getRoomManager: () => RoomManager,
  };

  console.info('[Phase3] ✅ Initialisation complète');
}

// ─────────────────────────────────────────────────────────────────────────
//  PATCH DU BOOT — Appeler initPhase3Complete après initApp
// ─────────────────────────────────────────────────────────────────────────
// On surcharge la fonction enterApp pour injecter la Phase 3 après initApp
const _origEnterApp = enterApp;
window.enterApp = function() {
  // enterApp appelle initApp via setTimeout — on patche initApp
  const _origInitApp = initApp;
  window.initApp = function() {
    _origInitApp();
    // Phase 3 s'initialise après que tout le reste est en place
    setTimeout(initPhase3Complete, 0);
  };
  _origEnterApp();
};


//  BOOT
// ═════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initSplashParticles();
  $('btn-enter')?.addEventListener('click', enterApp);
});
