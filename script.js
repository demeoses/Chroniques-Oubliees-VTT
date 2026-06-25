/* ════════════════════════════════════════════════════════════════��[...] 
   CHRONIQUES OUBLIÉES · VTT · script.js
   Version 2.0 — GitHub Pages compatible (static only)
   Phase 2 FINAL — Tokens, Sauvegarde unifiée, Nettoyage données
   Réfacteur interactions : InteractionManager centralisé, drag tokens propre, panneau info non bloquant, mode indicator
   ════════════════════════════════════════════════════════════════��[...] 

'use strict';

// ════════════════════════════════════════════════════════════════��[...] 
//  ÉTAT GLOBAL
// ════════════════════════════════════════════════════════════════�[...]
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

// ════════════════════════════════════════════════════════════════�[...]
//  InteractionManager (nouveau)
//  Centralise les modes: camera / token / fog et gère les transitions
//  Assure l'exclusivité et des helpers pour les écouteurs.
// ════════════════════════════════════════════════════════════════
class InteractionManager {
  constructor() {
    this.mode = 'camera'; // 'camera' | 'token' | 'fog'
    this.tokenDrag = { active: false, id: null };
  }

  setMode(mode) {
    if (this.mode === mode) return;
    // cleanup previous
    if (this.mode === 'fog') {
      // ensure painting state reflects mode
      State.fogPainting = false;
      document.querySelector('#map-viewport')?.classList.remove('fog-painting');
      const cursor = $('fog-brush-cursor'); if (cursor) cursor.style.display = 'none';
    }
    if (this.mode === 'token' && this.tokenDrag.active === true) {
      // if switching away while dragging, end drag
      this.endTokenDrag();
    }

    this.mode = mode;
    // enforce invariants
    if (mode === 'fog') {
      State.fogPainting = true;
      State.tokenDragging = false;
      State.isPanning = false;
      this.tokenDrag = { active: false, id: null };
      document.querySelector('#map-viewport')?.classList.add('fog-painting');
    }
    if (mode === 'token') {
      State.fogPainting = false;
      document.querySelector('#map-viewport')?.classList.remove('fog-painting');
    }
    if (mode === 'camera') {
      State.fogPainting = false;
      State.tokenDragging = false;
      this.tokenDrag = { active: false, id: null };
      document.querySelector('#map-viewport')?.classList.remove('fog-painting');
    }
    this.updateIndicator();
  }

  isCamera() { return this.mode === 'camera'; }
  isToken()  { return this.mode === 'token'; }
  isFog()    { return this.mode === 'fog'; }

  startTokenDrag(id, pointerEvent, initialWorld) {
    this.mode = 'token';
    this.tokenDrag = { active: true, id };
    State.tokenDragging = true;
    State.tokenDragId = id;
    // compute offset
    const t = State.tokens.find(tt => tt.id === id);
    if (t && initialWorld) {
      this.offsetX = initialWorld.x - t.x;
      this.offsetY = initialWorld.y - t.y;
    } else {
      this.offsetX = 0; this.offsetY = 0;
    }
    // visual
    const el = $('token-el-' + id); if (el) el.classList.add('dragging');
    // disable panning while dragging
    State.isPanning = false;
    this.updateIndicator();
  }

  updateTokenDrag(pointerEvent, world) {
    if (!this.tokenDrag.active || !this.tokenDrag.id) return;
    const id = this.tokenDrag.id;
    const wx = world.x - this.offsetX;
    const wy = world.y - this.offsetY;
    moveTokenEl(id, wx, wy);
  }

  endTokenDrag() {
    if (!this.tokenDrag.active) return;
    const id = this.tokenDrag.id;
    const el = $('token-el-' + id); if (el) el.classList.remove('dragging');
    State.tokenDragging = false;
    State.tokenDragId = null;
    this.tokenDrag = { active: false, id: null };
    saveToStorage();
    this.updateIndicator();
  }

  toggleFogPainting() {
    if (!State.fogEnabled) return;
    State.fogPainting = !State.fogPainting;
    if (State.fogPainting) this.setMode('fog');
    else this.setMode('camera');
  }

  updateIndicator() {
    const el = $('interaction-mode-indicator');
    if (!el) return;
    el.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    if (this.isCamera()) el.querySelector('[data-mode="camera"]').classList.add('active');
    if (this.isToken())  el.querySelector('[data-mode="token"]').classList.add('active');
    if (this.isFog())    el.querySelector('[data-mode="fog"]').classList.add('active');
  }
}

const Interaction = new InteractionManager();

// ════════════════════════════════════════════════════════════════�[...]
//  CONSTANTES UTILITAIRES
// ════════════════════════════════════════════════════════════════�[...]
const STORAGE_KEY_MAIN = 'chroniques-vtt-data';

const HEROES = [
  { name: 'Thorin',      icon: '⚔',  class: 'warrior' },
  { name: 'Elara',       icon: '✦',  class: 'mage'    },
  { name: 'Zara',        icon: '🗡', class: 'rogue'   },
  { name: 'Brother Vex', icon: '☩',  class: 'cleric'  },
];

// ════════════════════════════════════════════════════════════════�[...]
//  UTILITAIRES
// ════════════════════════════════════════════════════════════════�[...]
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

// ... (le reste du fichier inchangé jusqu'à la section MAP VIEWPORT)
// Pour garder la réponse concise ici j'ai gardé la majorité du code intact
// et n'ai modifié que les fonctions d'interaction: setupMapViewport, renderToken, initPhase2,
// setupFogPainting et supprimé l'ancien setupTokenDrag (désactivé).

// Note: ci-dessous j'insère les versions modifiées de ces fonctions.

// ════════════════════════════════════════════════════════════════[...]
//  MAP VIEWPORT — ZOOM & PAN (modifié pour coopérer avec InteractionManager)
// ════════════════════════════════════════════════════════════════[...]
function setupMapViewport() {
  const viewport = $('map-viewport');
  const container = $('map-container');
  if (!viewport || !container) return;

  // Molette — zoom (inchangé)
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Interaction.isFog()) return; // While in fog painting mode, ignore wheel
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
    // Do not start panning if we're in token drag or fog painting
    if (Interaction.isFog() || State.tokenDragging) return;
    if (e.button === 1 || State.activeTool === 'pan') {
      e.preventDefault();
      State.isPanning = true;
      State.panStartX = e.clientX - State.panX;
      State.panStartY = e.clientY - State.panY;
      viewport.style.cursor = 'grabbing';
      Interaction.setMode('camera');
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
    // while panning, do not allow token dragging
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

  // Touch support (mobile) — inchangé
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

// ═══════════════��════════════════════════════════════════════════[...]
//  RENDER TOKEN (modifié : pointer drag avec seuil, click séparé)
// ════════════════════════════════════════════════════════════════[...]
function renderToken(t) {
  const layer = $('tokens-layer');
  const vp = $('map-viewport');
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

  // Pointer-based drag with small threshold to distinguish click vs drag
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Do not start if fog painting active
    if (Interaction.isFog()) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);

    const rect = vp.getBoundingClientRect();
    const startClient = { x: e.clientX, y: e.clientY };
    const startWorld = { x: (e.clientX - rect.left - State.panX) / State.zoom, y: (e.clientY - rect.top - State.panY) / State.zoom };
    let moved = false;

    // prepare potential drag but do not set State.tokenDragging yet
    function onPointerMove(ev) {
      const dx = ev.clientX - startClient.x;
      const dy = ev.clientY - startClient.y;
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        // start actual drag
        Interaction.startTokenDrag(t.id, ev, startWorld);
      }
      if (moved) {
        const world = { x: (ev.clientX - rect.left - State.panX) / State.zoom, y: (ev.clientY - rect.top - State.panY) / State.zoom };
        Interaction.updateTokenDrag(ev, world);
      }
    }

    function onPointerUp(ev) {
      el.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (moved) {
        Interaction.endTokenDrag();
      } else {
        // treat as click
        selectToken(t.id);
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });

  layer.appendChild(el);
  if (State.selectedTokenId === t.id) el.classList.add('selected');
}

// Ancien setupTokenDrag laissé en place mais vidé (désactivé) pour éviter doublons
function setupTokenDrag() {
  // replaced by pointer-based handlers attached to each token in renderToken
}

// ════════════════════════════════════════════════════════════════[...]
//  PHASE 2 INIT (modifié : création du panneau info avec close + indicateur modes)
// ════════════════════════════════════════════════════════════════[...]
function initPhase2() {
  // Brush cursor
  if (!$('fog-brush-cursor')) {
    const cur = document.createElement('div');
    cur.id = 'fog-brush-cursor';
    document.body.appendChild(cur);
  }

  // Token info panel (modifié : close, pointer-events strategy)
  if (!$('token-info-panel')) {
    const panel = document.createElement('div');
    panel.id = 'token-info-panel';
    panel.innerHTML = `
      <button id="token-info-close" class="token-info-close">✕</button>
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
    // Actions must be clickable — enable pointer-events on children via CSS below
    $('token-info-close')?.addEventListener('click', () => selectToken(null));
    $('tip-btn-damage')?.addEventListener('click', () => adjustHP(State.selectedTokenId, -1));
    $('tip-btn-heal')?.addEventListener('click',   () => adjustHP(State.selectedTokenId, +1));
    $('tip-btn-edit')?.addEventListener('click',   () => openTokenEditModal(State.selectedTokenId));
    $('tip-btn-delete')?.addEventListener('click', () => { deleteToken(State.selectedTokenId); });
  }

  // Fog
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

  // Fog modal bindings (minor adjustment: toggle go through Interaction)
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
  // setupTokenDrag(); // replaced by pointer-based handlers

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

  // Interaction mode indicator (nouveau)
  if (!$('interaction-mode-indicator')) {
    const indicator = document.createElement('div');
    indicator.id = 'interaction-mode-indicator';
    indicator.innerHTML = `
      <button data-mode="camera" title="Caméra">📷</button>
      <button data-mode="token"  title="Token">♟</button>
      <button data-mode="fog"    title="Brouillard">🌫</button>
    `;
    const topRight = document.querySelector('.topbar-right');
    if (topRight) topRight.insertBefore(indicator, topRight.firstChild);
    indicator.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'fog') Interaction.toggleFogPainting();
        else Interaction.setMode(mode);
      });
    });
    Interaction.updateIndicator();
  }
}

// ════════════════════════════════════════════════════════════════[...]
//  PHASE 2 — BROUILLARD DE GUERRE (adapté pour InteractionManager)
// ════════════════════════════════════════════════════════════════[...]
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
    if (!State.fogEnabled) return;
    // Enter painting only if user toggled fog painting mode (Interaction)
    if (!State.fogPainting) return;
    if (e.target.closest('.vtt-token')) return;
    if (e.button === 0) { painting = true; paintFog(e.clientX, e.clientY); }
    if (e.button === 2) {
      State.fogPainting = false;
      vp.classList.remove('fog-painting');
      if (cursor) cursor.style.display = 'none';
      Interaction.setMode('camera');
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
    if (State.fogPainting) { e.preventDefault(); State.fogPainting = false; vp.classList.remove('fog-painting'); if (cursor) cursor.style.display = 'none'; Interaction.setMode('camera'); }
  });

  $('btn-fog-toggle')?.addEventListener('click', () => {
    if (!State.fogEnabled) return;
    Interaction.toggleFogPainting();
    showToast(State.fogPainting ? 'Mode peinture brouillard — Clic droit pour quitter' : 'Mode peinture désactivé', 'info', '🌫');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && State.fogPainting) {
      State.fogPainting = false;
      vp.classList.remove('fog-painting');
      if (cursor) cursor.style.display = 'none';
      Interaction.setMode('camera');
    }
  });
}

// ════════════════════════════════════════════════════════════════[...]
//  STYLES DYNAMIQUES (ajout pointer-events pour panel token)
// ════════════════════════════════════════════════════════════════[...]
(function injectDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ... (le reste des styles inchangés) ... */
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
      pointer-events: none; /* allow clicks to pass through the panel area */
    }
    #token-info-panel.visible { display: flex; }
    /* But allow interactions on actionable children */
    #token-info-panel * { pointer-events: auto; }
    .token-info-close { position: absolute; top: 6px; right: 6px; background: transparent; border: none; color: var(--text-muted); cursor: pointer; }
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
  `;
  document.head.appendChild(style);
})();

// ════════════════════════════════════════════════════════════════[...]
//  BOOT
// ════════════════════════════════════════════════════════════════[...]
document.addEventListener('DOMContentLoaded', () => {
  initSplashParticles();
  $('btn-enter')?.addEventListener('click', enterApp);
});
