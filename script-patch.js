/* ═══════════════════════════════════════════════════════════════════════════
   script-patch.js — Patch de compatibilité Supabase
   À inclure APRÈS script.js et supabase-multiplayer.js dans index.html
   Corrige les hooks WS restants et supprime le panneau WebSocket manuel
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function applySupabasePatch() {

  // Attendre que initApp() et initPhase3() soient exécutés
  const _waitReady = setInterval(() => {
    if (!window.State || !window.RoomManager || !window.WS) return;
    clearInterval(_waitReady);
    _patch();
  }, 100);

  function _patch() {

    // ── 1. Supprimer le panneau WS inutile ─────────────────────────────────
    //    _injectWSPanel() dans initPhase3 crée un champ de saisie URL WebSocket
    //    On le remplace par une bannière Supabase
    setTimeout(() => {
      const wsZone = document.getElementById('ws-config-zone');
      if (wsZone) {
        wsZone.innerHTML = `
          <div style="margin-top:8px;padding:8px 10px;background:rgba(39,174,96,0.08);border:1px solid rgba(39,174,96,0.2);border-radius:8px;font-size:0.7rem;color:#27ae60;text-align:center;">
            ✓ Connecté via Supabase
          </div>`;
      }
    }, 500);

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
              // Assigner sceneId courant
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
        if (window.Supabase?.state?.roomId) {
          window.Supabase.deleteToken(id);
        }
      };
    }

    // ── 6. Hook loadScene → Supabase (MJ seulement) ─────────────────────────
    const _origLoad = window.loadScene;
    if (_origLoad) {
      window.loadScene = function(scene) {
        _origLoad(scene);
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.changeScene(scene.id);
          // Aussi sauvegarder le fog de la scène précédente
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

    // Fog enable/disable
    const fogEnabledEl = document.getElementById('fog-enabled');
    if (fogEnabledEl) {
      fogEnabledEl.addEventListener('change', () => {
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          setTimeout(() => {
            window.Supabase.updateFog(window.State?.fogData || {}, window.State?.fogEnabled || false);
          }, 150);
        }
      });
    }

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
            currentTurn: window.State?.currentTurn,
            round:       window.State?.round,
            combatActive: window.State?.combatActive,
            initiativeOrder: window.State?.initiativeOrder,
          });
        }
      }, 100);
    });

    document.getElementById('btn-next-round')?.addEventListener('click', () => {
      setTimeout(() => {
        if (window.Supabase?.state?.roomId && window.Supabase?.state?.isGM) {
          window.Supabase.updateCombat({
            currentTurn: window.State?.currentTurn,
            round:       window.State?.round,
            combatActive: window.State?.combatActive,
            initiativeOrder: window.State?.initiativeOrder,
          });
        }
      }, 100);
    });

    // ── 10. Hook importation de scènes → Supabase ───────────────────────────
    // Quand une scène est ajoutée via import, la sauvegarder dans Supabase
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
      const canControl = t && (t.ownerPlayerId === myId);
      if (!canControl) {
        e.stopPropagation();
        if (window.showToast) showToast('Ce personnage ne vous appartient pas', 'warning', '⚠');
      }
    }, true);

    // ── 12. Intercept chat pour envoyer via Supabase ─────────────────────────
    // ChatUI.sendMessage appelle WS.send('SEND_CHAT', ...) — déjà intercepté
    // via le WS.send override dans supabase-multiplayer.js

    // ── 13. Créer salle — override modal buttons ─────────────────────────────
    const btnCreate = document.getElementById('btn-confirm-create-room');
    if (btnCreate) {
      // Retirer les handlers existants en clonant
      const newBtn = btnCreate.cloneNode(true);
      btnCreate.parentNode.replaceChild(newBtn, btnCreate);
      newBtn.addEventListener('click', async () => {
        const name    = document.getElementById('room-create-name')?.value.trim() || window.State?.campaignName || 'Ma Campagne';
        const gmName  = document.getElementById('room-create-gm-name')?.value.trim() || 'Maître du Jeu';
        const max     = document.getElementById('room-create-max-players')?.value || 4;
        const loading = document.getElementById('create-room-loading');
        if (loading) loading.style.display = 'block';
        newBtn.disabled = true;

        const result = await window.Supabase.createRoom(name, gmName, max);

        if (loading) loading.style.display = 'none';
        newBtn.disabled = false;

        if (result.ok) {
          if (window.closeAllModals) closeAllModals();
          else document.getElementById('modal-create-room')?.classList.add('hidden');
        }
      });
    }

    // ── 14. Rejoindre salle — override modal button ──────────────────────────
    const btnJoin = document.getElementById('btn-confirm-join-room');
    if (btnJoin) {
      const newBtn = btnJoin.cloneNode(true);
      btnJoin.parentNode.replaceChild(newBtn, btnJoin);
      newBtn.addEventListener('click', async () => {
        const code = document.getElementById('room-join-code')?.value.trim();
        const name = document.getElementById('room-join-player-name')?.value.trim();
        if (!code) { if (window.showToast) showToast('Entrez un code de salle', 'warning', '⚠'); return; }
        if (!name) { if (window.showToast) showToast('Entrez votre nom', 'warning', '⚠'); return; }

        const loading = document.getElementById('join-room-loading');
        if (loading) loading.style.display = 'block';
        newBtn.disabled = true;

        const result = await window.Supabase.joinRoom(code, name);

        if (loading) loading.style.display = 'none';
        newBtn.disabled = false;

        if (result.ok) {
          if (window.closeAllModals) closeAllModals();
          else document.getElementById('modal-join-room')?.classList.add('hidden');
        }
      });
    }

    // ── 15. Fermer salle ─────────────────────────────────────────────────────
    const btnClose = document.getElementById('btn-close-room');
    if (btnClose) {
      const newBtn = btnClose.cloneNode(true);
      btnClose.parentNode.replaceChild(newBtn, btnClose);
      newBtn.addEventListener('click', () => {
        if (confirm('Fermer la salle ? Tous les joueurs seront déconnectés.')) {
          window.Supabase.closeRoom();
        }
      });
    }

    // ── 16. Copier code ──────────────────────────────────────────────────────
    document.getElementById('btn-copy-code')?.addEventListener('click', () => {
      const code = window.Supabase?.state?.roomCode;
      if (code) {
        navigator.clipboard?.writeText(code).catch(()=>{});
        if (window.showToast) showToast(`Code copié : ${code}`, 'success', '📋');
      }
    });

    // ── 17. Fix : btn-join-room sur le splash-screen/panneau solo ───────────
    //    Ouvrir la modale rejoindre même sans être MJ
    document.getElementById('btn-join-room')?.addEventListener('click', () => {
      if (window.openModal) openModal('modal-join-room');
      else document.getElementById('modal-join-room')?.classList.remove('hidden');
    });

    // ── 18. Fix : btn-create-room ────────────────────────────────────────────
    document.getElementById('btn-create-room')?.addEventListener('click', () => {
      if (window.openModal) openModal('modal-create-room');
      else document.getElementById('modal-create-room')?.classList.remove('hidden');
    });

    // ── 19. Code en majuscules ───────────────────────────────────────────────
    document.getElementById('room-join-code')?.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    // ── 20. Fix btn-ambient — ne fait rien, on affiche un message ───────────
    document.getElementById('btn-ambient')?.addEventListener('click', () => {
      if (window.showToast) showToast('Sons d\'ambiance : fonctionnalité à venir', 'info', '🎵');
    });

    console.info('[Patch] ✅ Hooks Supabase installés');
  }

})();

/* ─── PATCH CHAT — Affichage optimiste + déduplication ──────────────────────
   ChatUI._send() envoie via WS.send('SEND_CHAT') → Supabase DB
   Le postgres_changes nous renvoie le message → _onChatMessage l'affiche
   Problème : si on attend le postgres_changes, délai visible (100–400ms)
   Solution : afficher immédiatement + ignorer le retour DB pour notre propre msg
   ─────────────────────────────────────────────────────────────────────────── */
(function patchChat() {
  const _waitChat = setInterval(() => {
    if (!window.ChatUI || !window.Session) return;
    clearInterval(_waitChat);

    // Ensemble des IDs de messages qu'on a envoyés nous-mêmes
    const _sentIds = new Set();

    // Override ChatUI._send
    const _origSend = ChatUI._send.bind(ChatUI);
    ChatUI._send = function() {
      const input = document.getElementById('chat-input');
      const text = input?.value?.trim();
      if (!text || !window.Supabase?.state?.roomId) {
        // Mode solo : comportement d'origine
        _origSend();
        return;
      }
      input.value = '';

      // Afficher immédiatement (optimiste)
      const myPlayer = window.Session?.getMyPlayer?.() || { name: window.Supabase?.state?.playerName || 'Joueur' };
      const msg = {
        id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        playerId:   window.Supabase?.state?.playerId,
        authorName: myPlayer?.name || (window.State?.playerRole === 'mj' ? 'Maître du Jeu' : 'Joueur'),
        role:       window.Supabase?.state?.playerRole || window.State?.playerRole || 'joueur',
        text,
        timestamp:  Date.now(),
      };
      _sentIds.add(msg.playerId + ':' + text.slice(0, 50));
      Session.addChatMessage?.(msg);
      ChatUI.appendMessage(msg);

      // Envoyer à Supabase (async, pas d'attente)
      window.Supabase.sendChat(text, 'chat', null);
    };

    // Patch _onChatMessage dans supabase-multiplayer pour dédupliquer nos propres msgs
    const _origOnChat = window._sbOnChatOverride;
    // Override la fonction d'affichage : ne pas afficher si c'est notre propre msg
    // On intercepte ChatUI.appendMessage pour checker
    const _origAppend = ChatUI.appendMessage.bind(ChatUI);
    ChatUI.appendMessage = function(msg) {
      // Si c'est un message DB qui correspond à ce qu'on vient d'envoyer, ignorer
      if (msg.playerId === window.Supabase?.state?.playerId) {
        const key = msg.playerId + ':' + (msg.text||'').slice(0, 50);
        if (_sentIds.has(key)) {
          _sentIds.delete(key);
          return; // déjà affiché optimistiquement
        }
      }
      _origAppend(msg);
    };

    // Afficher le chat pour les joueurs aussi (pas seulement MJ)
    // Le bouton chat est dans .action-center qui a class gm-only — retirer gm-only
    setTimeout(() => {
      const actionCenter = document.querySelector('.action-center');
      if (actionCenter) actionCenter.classList.remove('gm-only');
      // Mais garder les boutons initiative/end-turn/next-round masqués pour les joueurs
      if (window.State?.playerRole === 'joueur') {
        ['btn-roll-initiative','btn-end-turn','btn-next-round','round-counter'].forEach(id => {
          const el = document.getElementById(id) || document.querySelector('.' + id);
          if (el) el.style.display = 'none';
        });
      }
    }, 800);

    console.info('[PatchChat] ✅ Chat Supabase optimiste activé');
  }, 150);
})();
