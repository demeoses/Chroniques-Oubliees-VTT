/* ═══════════════════════════════════════════════════════════════════════════
   script-patch.js — Patch de compatibilité Supabase
   À inclure APRÈS script.js et supabase-multiplayer.js dans index.html
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PATCH #0 — Boutons DOM directs (aucune dépendance)
   S'attache au DOMContentLoaded, sans attendre WS / State / RoomManager.
   C'est le seul endroit où ces boutons sont câblés.
   ════════════════════════════════════════════════════════════════════════════ */
(function patchDOMButtons() {

  function _openModal(id) {
    if (typeof window.openModal === 'function') { window.openModal(id); return; }
    document.getElementById(id)?.classList.remove('hidden');
  }

  function _closeModal(id) {
    if (typeof window.closeAllModals === 'function') { window.closeAllModals(); return; }
    document.getElementById(id)?.classList.add('hidden');
  }

  function _bind() {

    // ── btn-enter : Entrer dans la Taverne ──────────────────────────────────
    const btnEnter = document.getElementById('btn-enter');
    if (btnEnter && !btnEnter._pbound) {
      btnEnter._pbound = true;
      btnEnter.addEventListener('click', () => {
        if (typeof window.initApp === 'function') { window.initApp(); return; }
        // Fallback si script.js absent / planté
        const splash = document.getElementById('splash-screen');
        const app    = document.getElementById('app');
        if (splash) splash.style.display = 'none';
        if (app)    app.classList.remove('hidden');
        console.info('[Patch#0] fallback splash→app');
      });
    }

    // ── btn-create-room : ouvre le modal créer ──────────────────────────────
    const btnOpenCreate = document.getElementById('btn-create-room');
    if (btnOpenCreate && !btnOpenCreate._pbound) {
      btnOpenCreate._pbound = true;
      btnOpenCreate.addEventListener('click', () => _openModal('modal-create-room'));
    }

    // ── btn-join-room : ouvre le modal rejoindre ────────────────────────────
    const btnOpenJoin = document.getElementById('btn-join-room');
    if (btnOpenJoin && !btnOpenJoin._pbound) {
      btnOpenJoin._pbound = true;
      btnOpenJoin.addEventListener('click', () => _openModal('modal-join-room'));
    }

    // ── btn-confirm-create-room ──────────────────────────────────────────────
    const btnCreate = document.getElementById('btn-confirm-create-room');
    if (btnCreate && !btnCreate._pbound) {
      btnCreate._pbound = true;
      btnCreate.addEventListener('click', async () => {
        if (!window.Supabase) {
          console.error('[Patch] window.Supabase non disponible');
          if (window.showToast) showToast('Supabase non chargé', 'warning', '⚠');
          return;
        }
        const name   = document.getElementById('room-create-name')?.value.trim()    || 'Ma Campagne';
        const gmName = document.getElementById('room-create-gm-name')?.value.trim() || 'Maître du Jeu';
        const max    = parseInt(document.getElementById('room-create-max-players')?.value, 10) || 4;

        const loading = document.getElementById('create-room-loading');
        if (loading) loading.style.display = 'block';
        btnCreate.disabled = true;

        try {
          const result = await window.Supabase.createRoom(name, gmName, max);
          if (result.ok) _closeModal('modal-create-room');
        } finally {
          if (loading) loading.style.display = 'none';
          btnCreate.disabled = false;
        }
      });
    }

    // ── btn-confirm-join-room ────────────────────────────────────────────────
    const btnJoin = document.getElementById('btn-confirm-join-room');
    if (btnJoin && !btnJoin._pbound) {
      btnJoin._pbound = true;
      btnJoin.addEventListener('click', async () => {
        if (!window.Supabase) {
          console.error('[Patch] window.Supabase non disponible');
          if (window.showToast) showToast('Supabase non chargé', 'warning', '⚠');
          return;
        }
        const code = document.getElementById('room-join-code')?.value.trim().toUpperCase();
        const name = document.getElementById('room-join-player-name')?.value.trim();

        if (!code) { if (window.showToast) showToast('Entrez un code de salle', 'warning', '⚠'); return; }
        if (!name) { if (window.showToast) showToast('Entrez votre nom', 'warning', '⚠'); return; }

        const errEl = document.getElementById('room-join-error');
        if (errEl) errEl.style.display = 'none';

        const loading = document.getElementById('join-room-loading');
        if (loading) loading.style.display = 'block';
        btnJoin.disabled = true;

        try {
          const result = await window.Supabase.joinRoom(code, name);
          if (result.ok) _closeModal('modal-join-room');
        } finally {
          if (loading) loading.style.display = 'none';
          btnJoin.disabled = false;
        }
      });
    }

    // ── btn-close-room ───────────────────────────────────────────────────────
    const btnClose = document.getElementById('btn-close-room');
    if (btnClose && !btnClose._pbound) {
      btnClose._pbound = true;
      btnClose.addEventListener('click', () => {
        if (confirm('Fermer la salle ? Tous les joueurs seront déconnectés.')) {
          window.Supabase?.closeRoom();
        }
      });
    }

    // ── btn-copy-code ────────────────────────────────────────────────────────
    const btnCopy = document.getElementById('btn-copy-code');
    if (btnCopy && !btnCopy._pbound) {
      btnCopy._pbound = true;
      btnCopy.addEventListener('click', () => {
        const code = window.Supabase?.state?.roomCode;
        if (code) {
          navigator.clipboard?.writeText(code).catch(() => {});
          if (window.showToast) showToast('Code copié : ' + code, 'success', '📋');
        }
      });
    }

    // ── Code salle en majuscules ─────────────────────────────────────────────
    const codeInput = document.getElementById('room-join-code');
    if (codeInput && !codeInput._pbound) {
      codeInput._pbound = true;
      codeInput.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
    }

    // ── btn-ambient ──────────────────────────────────────────────────────────
    const btnAmbient = document.getElementById('btn-ambient');
    if (btnAmbient && !btnAmbient._pbound) {
      btnAmbient._pbound = true;
      btnAmbient.addEventListener('click', () => {
        if (window.showToast) showToast("Sons d'ambiance : fonctionnalité à venir", 'info', '🎵');
      });
    }

    console.info('[Patch#0] Boutons DOM câblés ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bind);
  } else {
    _bind();
  }

})();


/* ════════════════════════════════════════════════════════════════════════════
   PATCH #1 — Hooks post-app (State, WS, RoomManager, ChatUI requis)
   S'exécute après que initApp() a tourné et que l'app est visible.
   ════════════════════════════════════════════════════════════════════════════ */
(function applySupabasePatch() {

  const _waitReady = setInterval(() => {
    if (document.getElementById('app')?.classList.contains('hidden')) return;
    if (!window.State || !window.RoomManager || !window.WS) return;
    if (!window.ChatUI) return;
    clearInterval(_waitReady);
    _patch();
  }, 100);

  function _patch() {

    // ── 1. Remplacer le panneau WS par bannière Supabase ────────────────────
    function _replaceWSPanel() {
      const wsZone = document.getElementById('ws-config-zone');
      if (!wsZone) return false;
      wsZone.innerHTML = `
        <div style="margin-top:8px;padding:8px 12px;background:rgba(39,174,96,0.1);border:1px solid rgba(39,174,96,0.25);border-radius:8px;display:flex;align-items:center;gap:8px;">
          <span style="color:#27ae60;font-size:1rem;">✓</span>
          <div>
            <div style="font-size:0.72rem;color:#27ae60;font-weight:600;">Supabase connecté</div>
            <div style="font-size:0.65rem;color:#5a8a6a;">Multijoueur via Supabase Realtime</div>
          </div>
        </div>`;
      return true;
    }
    if (!_replaceWSPanel()) {
      const _wsRetry = setInterval(() => { if (_replaceWSPanel()) clearInterval(_wsRetry); }, 100);
      setTimeout(() => clearInterval(_wsRetry), 3000);
    }

    // Bloquer WS.connect natif
    if (window.WS) {
      WS.connect = () => console.info('[Patch] WS.connect() bloqué — Supabase actif');
    }

    // ── 2. Hook moveTokenEl → Supabase ──────────────────────────────────────
    const _origMove = window.moveTokenEl;
    if (_origMove) {
      window.moveTokenEl = function(id, x, y, doSnap) {
        _origMove(id, x, y, doSnap);
        if (doSnap && window.Supabase?.state?.roomId) {
          const t = window.State?.tokens?.find(t => t.id === id);
          if (t) window.Supabase.moveToken(id, t.x, t.y);
        }
      };
    }

    // ── 3. Hook adjustHP → Supabase ─────────────────────────────────────────
    const _origHP = window.adjustHP;
    if (_origHP) {
      window.adjustHP = function(id, delta) {
        _origHP(id, delta);
        if (window.Supabase?.state?.roomId) {
          const t = window.State?.tokens?.find(t => t.id === id);
          if (t) window.Supabase.updateTokenHp(id, t.hp);
        }
      };
    }

    // ── 4. Hook saveTokenFromModal → Supabase ───────────────────────────────
    const _origSave = window.saveTokenFromModal;
    if (_origSave) {
      window.saveTokenFromModal = function() {
        const editId = document.getElementById('token-edit-id')?.value || '';
        const prevCount = window.State?.tokens?.length || 0;
        _origSave();
        if (!window.Supabase?.state?.roomId) return;
        setTimeout(() => {
          if (!editId && (window.State?.tokens?.length || 0) > prevCount) {
            const newTok = window.State.tokens[window.State.tokens.length - 1];
            if (newTok) {
              newTok.sceneId = window.State?.currentSceneId || null;
              window.Supabase.upsertToken(newTok);
            }
          } else if (editId) {
            const t = window.State?.tokens?.find(t => t.id === editId);
            if (t) window.Supabase.upsertToken(t);
          }
        }, 80);
      };
    }

    // ── 5. Hook deleteToken → Supabase ──────────────────────────────────────
    const _origDel = window.deleteToken;
    if (_origDel) {
      window.deleteToken = function(id) {
        _origDel(id);
        if (window.Supabase?.state?.roomId) window.Supabase.deleteToken(id);
      };
    }

    // ── 6. Hook loadScene → Supabase (MJ seulement) ─────────────────────────
    const _origLoad = window.loadScene;
    if (_origLoad) {
      window.loadScene = function(scene) {
        _origLoad(scene);
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.changeScene(scene.id);
          if (scene.fogData !== undefined) {
            window.State.fogData = scene.fogData || {};
            if (window.redrawFogCanvas) redrawFogCanvas();
          }
        }
      };
    }

    // ── 7. Hook fog painting → Supabase ─────────────────────────────────────
    let _fogSbTimer = null;
    const _origPaint = window.paintFogCells;
    if (_origPaint) {
      window.paintFogCells = function(wx, wy) {
        _origPaint(wx, wy);
        if (!window.Supabase?.state?.roomId || !window.Supabase?.state?.isGM) return;
        clearTimeout(_fogSbTimer);
        _fogSbTimer = setTimeout(() => {
          window.Supabase.updateFog(window.State?.fogData || {}, window.State?.fogEnabled || false);
        }, 700);
      };
    }

    const _origRevealAll = window.fogRevealAll;
    if (_origRevealAll) {
      window.fogRevealAll = function() {
        _origRevealAll();
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.updateFog(window.State?.fogData || {}, window.State?.fogEnabled || false);
        }
      };
    }

    const _origHideAll = window.fogHideAll;
    if (_origHideAll) {
      window.fogHideAll = function() {
        _origHideAll();
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.updateFog(window.State?.fogData || {}, window.State?.fogEnabled || false);
        }
      };
    }

    document.getElementById('fog-enabled')?.addEventListener('change', () => {
      if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
        setTimeout(() => {
          window.Supabase.updateFog(window.State?.fogData || {}, window.State?.fogEnabled || false);
        }, 150);
      }
    });

    // ── 8. Hook combat → Supabase ────────────────────────────────────────────
    if (window.CombatManager) {
      const _origLaunch = window.CombatManager.launchWithSelected?.bind(window.CombatManager);
      if (_origLaunch) {
        window.CombatManager.launchWithSelected = function() {
          _origLaunch();
          if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
            window.Supabase.updateCombat({
              combatActive:    window.State?.combatActive,
              initiativeOrder: window.State?.initiativeOrder,
              currentTurn:     window.State?.currentTurn,
              round:           window.State?.round,
            });
          }
        };
      }

      const _origEnd = window.CombatManager.endCombat?.bind(window.CombatManager);
      if (_origEnd) {
        window.CombatManager.endCombat = function() {
          _origEnd();
          if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
            window.Supabase.updateCombat({ combatActive: false, initiativeOrder: [], currentTurn: 0, round: 0 });
          }
        };
      }
    }

    // ── 9. Hook btn-end-turn et btn-next-round → Supabase ───────────────────
    document.getElementById('btn-end-turn')?.addEventListener('click', () => {
      setTimeout(() => {
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.updateCombat({
            currentTurn:     window.State?.currentTurn,
            round:           window.State?.round,
            combatActive:    window.State?.combatActive,
            initiativeOrder: window.State?.initiativeOrder,
          });
        }
      }, 100);
    });

    document.getElementById('btn-next-round')?.addEventListener('click', () => {
      setTimeout(() => {
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.updateCombat({
            currentTurn:     window.State?.currentTurn,
            round:           window.State?.round,
            combatActive:    window.State?.combatActive,
            initiativeOrder: window.State?.initiativeOrder,
          });
        }
      }, 100);
    });

    // ── 10. Hook importation de scènes → Supabase ───────────────────────────
    const _origRender = window.renderScenesList;
    if (_origRender) {
      let _lastSceneCount = window.State?.scenes?.length || 0;
      window.renderScenesList = function() {
        _origRender();
        const currentCount = window.State?.scenes?.length || 0;
        if (currentCount > _lastSceneCount && window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          const newScenes = (window.State?.scenes || []).slice(_lastSceneCount);
          newScenes.forEach(s => window.Supabase.upsertScene(s));
        }
        _lastSceneCount = currentCount;
      };
    }

    // ── 11. Permission joueur : bloquer interaction tokens non assignés ──────
    document.addEventListener('mousedown', (e) => {
      if (window.State?.playerRole !== 'joueur') return;
      const tokenEl = e.target.closest('.vtt-token');
      if (!tokenEl) return;
      const tokenId = tokenEl.dataset.tokenId;
      const t = window.State?.tokens?.find(t => t.id === tokenId);
      const myId = window.Supabase?.state?.playerId;
      if (!(t && t.ownerPlayerId === myId)) {
        e.stopPropagation();
        if (window.showToast) showToast('Ce personnage ne vous appartient pas', 'warning', '⚠');
      }
    }, true);

    console.info('[Patch#1] ✅ Hooks Supabase post-app installés');
  }

})();


/* ════════════════════════════════════════════════════════════════════════════
   PATCH CHAT — Affichage optimiste + déduplication
   ════════════════════════════════════════════════════════════════════════════ */
(function patchChat() {
  const _waitChat = setInterval(() => {
    if (!window.ChatUI || !window.Session) return;
    clearInterval(_waitChat);

    const _sentIds = new Set();

    const _origSend = ChatUI._send.bind(ChatUI);
    ChatUI._send = function() {
      const input = document.getElementById('chat-input');
      const text = input?.value?.trim();
      if (!text || !window.Supabase?.state?.roomId) {
        _origSend();
        return;
      }
      input.value = '';

      const myPlayer = window.Session?.getMyPlayer?.() || { name: window.Supabase?.state?.playerName || 'Joueur' };
      const msg = {
        id:         'local-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        playerId:   window.Supabase?.state?.playerId,
        authorName: myPlayer?.name || (window.State?.playerRole === 'mj' ? 'Maître du Jeu' : 'Joueur'),
        role:       window.Supabase?.state?.playerRole || window.State?.playerRole || 'joueur',
        text,
        timestamp:  Date.now(),
      };
      _sentIds.add(msg.playerId + ':' + text.slice(0, 50));
      Session.addChatMessage?.(msg);
      ChatUI.appendMessage(msg);
      window.Supabase.sendChat(text, 'chat', null);
    };

    const _origAppend = ChatUI.appendMessage.bind(ChatUI);
    ChatUI.appendMessage = function(msg) {
      if (msg.playerId === window.Supabase?.state?.playerId) {
        const key = msg.playerId + ':' + (msg.text || '').slice(0, 50);
        if (_sentIds.has(key)) { _sentIds.delete(key); return; }
      }
      _origAppend(msg);
    };

    // Afficher le chat pour les joueurs aussi
    setTimeout(() => {
      const actionCenter = document.querySelector('.action-center');
      if (actionCenter) actionCenter.classList.remove('gm-only');
      if (window.State?.playerRole === 'joueur') {
        ['btn-roll-initiative', 'btn-end-turn', 'btn-next-round', 'round-counter'].forEach(id => {
          const el = document.getElementById(id) || document.querySelector('.' + id);
          if (el) el.style.display = 'none';
        });
      }
    }, 800);

    console.info('[PatchChat] ✅ Chat Supabase optimiste activé');
  }, 150);
})();
