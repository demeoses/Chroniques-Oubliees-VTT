/* ════════════════════════════════════════════════════════════════��[...]
   CHRONIQUES OUBLIÉES · VTT · script.js
   Version 2.0 — GitHub Pages compatible (static only)
   Phase 2 FINAL — Tokens, Sauvegarde unifiée, Nettoyage données
   Réfacteur interactions : InteractionManager centralisé, drag tokens propre, panneau info non bloquant, mode indicator
   =================================================================================
*/

'use strict';

// ════════════════════════════════════════════════════════════════�[...]
//  ÉTAT GLOBAL
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
//  InteractionManager (nouveau)
//  Centralise les modes: camera / token et gère les pointer events
//  Assure l'exclusivité et des helpers pour les écouteurs.
//  Note: fog mode and fog painting will be integrated later; this step
//  implements CAMERA and TOKEN modes only, and disables older global handlers.
// ════════════════════════════════════════════════════════════════
class InteractionManager {
  constructor() {
    this.mode = 'camera'; // 'camera' | 'token'
    this.viewport = null;
    this.pending = null; // transient pointer session
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    // clear any transient state
    this.pending = null;
    State.isPanning = false;
    State.tokenDragging = false;
    // update visual indicator if present
    this.updateIndicator?.();
  }

  isCamera() { return this.mode === 'camera'; }
  isToken()  { return this.mode === 'token'; }

  attachViewport(vp) {
    if (!vp || this._attached) return;
    this.viewport = vp;
    vp.style.touchAction = 'none';
    vp.addEventListener('pointerdown', this._onPointerDown.bind(this));
    window.addEventListener('pointermove', this._onPointerMove.bind(this));
    window.addEventListener('pointerup', this._onPointerUp.bind(this));
    window.addEventListener('pointercancel', this._onPointerUp.bind(this));
    this._attached = true;
  }

  _onPointerDown(e) {
    if (!this.viewport) return;
    // Don't interfere if fog painting active
    if (State.fogPainting) return;

    const rect = this.viewport.getBoundingClientRect();
    const startClient = { x: e.clientX, y: e.clientY };
    const world = { x: (e.clientX - rect.left - State.panX) / State.zoom, y: (e.clientY - rect.top - State.panY) / State.zoom };

    const tokenEl = e.target && e.target.closest ? e.target.closest('.vtt-token') : null;

    // TOKEN mode: pointer on token => prepare token drag (wait for movement)
    if (tokenEl && this.isToken() && e.button === 0) {
      const id = tokenEl.dataset.tokenId;
      this.pending = { kind: 'token', id, startClient, startWorld: world, moved: false, pointerId: e.pointerId };
      try { this.viewport.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }

    // CAMERA mode: pan with middle mouse or pan tool
    const wantPan = (e.button === 1) || (State.activeTool === 'pan');
    if (wantPan && this.isCamera()) {
      this.pending = { kind: 'pan', startClient, panStartX: State.panX, panStartY: State.panY, moved: false, pointerId: e.pointerId };
      State.isPanning = true;
      try { this.viewport.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }

    // TOKEN mode: background click to deselect
    if (!tokenEl && this.isToken() && e.button === 0) {
      this.pending = { kind: 'bgclick', startClient, moved: false, pointerId: e.pointerId };
      try { this.viewport.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }

    // else: do nothing (leave event to other handlers)
  }

  _onPointerMove(e) {
    if (!this.pending) return;
    if (e.pointerId !== this.pending.pointerId) return;
    const dx = e.clientX - this.pending.startClient.x;
    const dy = e.clientY - this.pending.startClient.y;
    const dist = Math.hypot(dx, dy);

    if (this.pending.kind === 'token') {
      if (!this.pending.moved && dist > 4) {
        this.pending.moved = true;
        this.startTokenDrag(this.pending.id, e, this.pending.startWorld);
      }
      if (this.pending.moved) {
        const rect = this.viewport.getBoundingClientRect();
        const world = { x: (e.clientX - rect.left - State.panX) / State.zoom, y: (e.clientY - rect.top - State.panY) / State.zoom };
        this.updateTokenDrag(e, world);
      }
      return;
    }

    if (this.pending.kind === 'pan') {
      State.panX = e.clientX - this.pending.panStartX;
      State.panY = e.clientY - this.pending.panStartY;
      applyTransform();
      updateMinimap();
      this.pending.moved = true;
      return;
    }

    if (this.pending.kind === 'bgclick') {
      if (dist > 4) this.pending.moved = true;
    }
  }

  _onPointerUp(e) {
    if (!this.pending) return;
    if (e.pointerId !== this.pending.pointerId) return;
    try { this.viewport.releasePointerCapture(e.pointerId); } catch (err) {}

    if (this.pending.kind === 'token') {
      if (!this.pending.moved) {
        selectToken(this.pending.id);
      } else {
        this.endTokenDrag();
      }
    } else if (this.pending.kind === 'pan') {
      State.isPanning = false;
    } else if (this.pending.kind === 'bgclick') {
      if (!this.pending.moved) selectToken(null);
    }

    this.pending = null;
  }

  startTokenDrag(id, pointerEvent, initialWorld) {
    this.mode = 'token';
    State.tokenDragging = true;
    State.tokenDragId = id;
    const t = State.tokens.find(tt => tt.id === id);
    if (t && initialWorld) {
      this._offsetX = initialWorld.x - t.x;
      this._offsetY = initialWorld.y - t.y;
    } else { this._offsetX = 0; this._offsetY = 0; }
    const el = $('token-el-' + id); if (el) el.classList.add('dragging');
  }

  updateTokenDrag(pointerEvent, world) {
    if (!State.tokenDragging || !State.tokenDragId) return;
    const wx = world.x - (this._offsetX || 0);
    const wy = world.y - (this._offsetY || 0);
    moveTokenEl(State.tokenDragId, wx, wy);
  }

  endTokenDrag() {
    if (!State.tokenDragging) return;
    const id = State.tokenDragId;
    const el = $('token-el-' + id); if (el) el.classList.remove('dragging');
    State.tokenDragging = false;
    State.tokenDragId = null;
    saveToStorage();
  }

  updateIndicator() {
    const el = $('interaction-mode-indicator');
    if (!el) return;
    el.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    if (this.isCamera()) el.querySelector('[data-mode="camera"]').classList.add('active');
    if (this.isToken()) el.querySelector('[data-mode="token"]').classList.add('active');
  }
}

const Interaction = new InteractionManager();

// ════════════════════════════════════════════════════════════════
//  CONSTANTES UTILITAIRES
// ════════════════════════════════════════════════════════════════
const STORAGE_KEY_MAIN = 'chroniques-vtt-data';

const HEROES = [
  { name: 'Thorin',      icon: '⚔',  class: 'warrior' },
  { name: 'Elara',       icon: '✦',  class: 'mage'    },
  { name: 'Zara',        icon: '🗡', class: 'rogue'   },
  { name: 'Brother Vex', icon: '☩',  class: 'cleric'  },
];

// ════════════════════════════════════════════════════════════════
//  UTILITAIRES
// ════════════════════════════════════════════════════════════════
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

// ... rest of the file unchanged until map viewport setup ...

// ════════════════════════════════════════════════════════════════
//  MAP VIEWPORT — ZOOM & PAN (delegated to InteractionManager)
// ════════════════════════════════════════════════════════════════
function setupMapViewport() {
  const viewport = $('map-viewport');
  const container = $('map-container');
  if (!viewport || !container) return;

  // Molette — zoom (preserve behavior but ignore during token drag or fog painting)
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (State.fogPainting || State.tokenDragging) return;
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

  // Delegate pointer handling for pan/select/drag to InteractionManager
  Interaction.attachViewport(viewport);
}

// ════════════════════════════════════════════════════════════════
//  RENDER TOKEN (now only builds the token element; InteractionManager handles pointer events)
// ════════════════════════════════════════════════════════════════
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
  el.style.touchAction = 'none';

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

// Disable old global token drag system (no-op)
function setupTokenDrag() {
  // Old implementation intentionally removed. InteractionManager now handles pointer interactions.
}

// In initPhase2: remove direct mousedown background deselect since InteractionManager handles it
// (we ensure we do not add another competing listener)
function initPhase2() {
  // Brush cursor
  if (!$('fog-brush-cursor')) {
    const cur = document.createElement('div'); cur.id = 'fog-brush-cursor'; document.body.appendChild(cur);
  }

  // Token info panel (unchanged creation)
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
    $('token-info-close')?.addEventListener('click', () => selectToken(null));
    $('tip-btn-damage')?.addEventListener('click', () => adjustHP(State.selectedTokenId, -1));
    $('tip-btn-heal')?.addEventListener('click',   () => adjustHP(State.selectedTokenId, +1));
    $('tip-btn-edit')?.addEventListener('click',   () => openTokenEditModal(State.selectedTokenId));
    $('tip-btn-delete')?.addEventListener('click', () => { deleteToken(State.selectedTokenId); });
  }

  // Fog initialization unchanged
  ensureFogCanvas(); applyFogVisibility(); restoreFogCanvas();

  // Render tokens
  State.tokens.forEach(t => renderToken(t));

  // Wire modal buttons and other UI (unchanged)
  $('btn-new-token-from-panel')?.addEventListener('click', () => { closeAllModals(); openTokenCreateModal(); });
  $('btn-token-img-pick')?.addEventListener('click', () => $('token-img-file')?.click());
  $('token-img-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (ev) => { _pendingImgData = ev.target.result; const nm = $('token-img-name'); if (nm) nm.textContent = file.name; const prev = $('token-img-preview'); if (prev) prev.style.display = 'block'; const prevImg = $('token-img-preview-img'); if (prevImg) prevImg.src = _pendingImgData; };
    reader.readAsDataURL(file);
  });
  $('btn-token-save')?.addEventListener('click', saveTokenFromModal);
  $('btn-token-cancel')?.addEventListener('click', closeAllModals);

  // Fog modal bindings (unchanged)
  $('fog-enabled')?.addEventListener('change', (e) => { State.fogEnabled = e.target.checked; applyFogVisibility(); saveToStorage(); showToast(State.fogEnabled ? 'Brouillard activé' : 'Brouillard désactivé', 'info', '🌫'); });
  $('fog-opacity')?.addEventListener('input', (e) => { State.fogOpacity = parseFloat(e.target.value); applyFogOpacity(); });
  $('fog-brush-size')?.addEventListener('change', (e) => { State.fogBrushSize = parseInt(e.target.value, 10) || 2; });
  document.querySelectorAll('.fog-tool-btn').forEach(btn => { btn.addEventListener('click', () => { State.fogTool = btn.dataset.fogTool; document.querySelectorAll('.fog-tool-btn').forEach(b => b.classList.toggle('active', b === btn)); }); });
  $('btn-fog-reveal-all')?.addEventListener('click', fogRevealAll);
  $('btn-fog-hide-all')?.addEventListener('click', fogHideAll);

  // Topbar buttons
  $('btn-tokens-panel')?.addEventListener('click', () => { renderTokensListPanel(); openModal('modal-tokens-panel'); });
  $('btn-fog-panel')?.addEventListener('click', () => { const fChk = $('fog-enabled'); if (fChk) fChk.checked = State.fogEnabled; const fOp  = $('fog-opacity');  if (fOp)  fOp.value  = State.fogOpacity; const fBr  = $('fog-brush-size'); if (fBr) fBr.value = State.fogBrushSize; openModal('modal-fog'); });

  // Search tokens
  const searchInput = $('token-search-input');
  if (searchInput) { searchInput.addEventListener('input', (e) => { const query = e.target.value.toLowerCase(); document.querySelectorAll('.token-list-row').forEach(row => { const name = row.querySelector('.token-list-name')?.textContent.toLowerCase() || ''; row.style.display = name.includes(query) ? 'flex' : 'none'; }); }); }

  setupFogPainting();
  setupTokenDrag(); // no-op now; InteractionManager handles token drag

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && State.selectedTokenId) { deleteToken(State.selectedTokenId); }
  });

  // Interaction mode indicator (unchanged)
  if (!$('interaction-mode-indicator')) {
    const indicator = document.createElement('div'); indicator.id = 'interaction-mode-indicator';
    indicator.innerHTML = `\n      <button data-mode="camera" title="Caméra">📷</button>\n      <button data-mode="token"  title="Token">♟</button>\n      <button data-mode="fog"    title="Brouillard">🌫</button>\n    `;
    const topRight = document.querySelector('.topbar-right'); if (topRight) topRight.insertBefore(indicator, topRight.firstChild);
    indicator.querySelectorAll('button').forEach(btn => { btn.addEventListener('click', () => { const mode = btn.dataset.mode; if (mode === 'fog') Interaction.toggleFogPainting(); else Interaction.setMode(mode); }); });
    Interaction.updateIndicator();
  }
}

// ════════════════════════════════════════════════════════════════
//  STYLES DYNAMIQUES (unchanged)
// ════════════════════════════════════════════════════════════════
(function injectDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ... (styles unchanged) ... */
  `;
  document.head.appendChild(style);
})();

// ════════════════════════════════════════════════════════════════
//  BOOT (fix: robust binding for the splash "Entrer" button)
// ════════════════════════════════════════════════════════════════
function bindEnterButton() {
  try { const btn = $('btn-enter'); if (!btn) return; if (btn.__enterBound) return; btn.addEventListener('click', enterApp); btn.__enterBound = true; } catch (e) { console.warn('bindEnterButton error', e); }
}

document.addEventListener('DOMContentLoaded', () => { initSplashParticles(); bindEnterButton(); });
bindEnterButton();
setTimeout(bindEnterButton, 500);

// ════════════════════════════════════════════════════════════════
//  TOOLBAR changes: map tools to Interaction modes
// ════════════════════════════════════════════════════════════════
function setupToolbar() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      State.activeTool = btn.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const viewport = $('map-viewport');
      if (viewport) { viewport.style.cursor = State.activeTool === 'pan' ? 'grab' : 'default'; }

      // Map tool to Interaction mode
      if (State.activeTool === 'pan') Interaction.setMode('camera');
      else Interaction.setMode('token');

      updateLog(`Outil : ${btn.querySelector('span')?.textContent || btn.dataset.tool}`);
    });
  });

  $('btn-zoom-in')?.addEventListener('click', () => { State.zoom = clamp(State.zoom * 1.2, State.minZoom, State.maxZoom); applyTransform(); updateZoomLabel(); updateMinimap(); });
  $('btn-zoom-out')?.addEventListener('click', () => { State.zoom = clamp(State.zoom / 1.2, State.minZoom, State.maxZoom); applyTransform(); updateZoomLabel(); updateMinimap(); });
  $('btn-fit-view')?.addEventListener('click', () => { fitView(); updateMinimap(); showToast('Vue ajustée', 'info', '⊞'); });
  $('btn-ambient')?.addEventListener('click', () => { showToast("Sons d'ambiance (Phase 3)", 'warning', '🎵'); });
}

function activateTool(tool) {
  State.activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach(b => { b.classList.toggle('active', b.dataset.tool === tool); });
  const viewport = $('map-viewport'); if (viewport) viewport.style.cursor = tool === 'pan' ? 'grab' : 'default';
  // Map to Interaction mode: pan -> camera, others -> token
  if (tool === 'pan') Interaction.setMode('camera'); else Interaction.setMode('token');
}

// The rest of the code (save/load, fog, tokens, scenes, modals, etc.) remains unchanged
// and is present below in the repository. This commit only centralizes pointer
// interactions for camera and tokens and disables the older global handlers.
