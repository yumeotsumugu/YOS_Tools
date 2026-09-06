/* =============================================================
   YOS Tools — 共通テーマ設定
   すべてのツールで「システム / ライト / ダーク」を共有する。
   - localStorage キー: 'yos.theme'（値: 'system' | 'light' | 'dark'）
   - <head> で同期読み込みし、描画前に <html data-theme> を適用（ちらつき防止）
   - 各ツールは <button data-yos-theme-toggle></button> を置くだけで
     共通トグルボタンになる（アイコン・イベントはこのスクリプトが付与）
   ============================================================= */
(function () {
  'use strict';

  var KEY = 'yos.theme';
  var LEGACY_KEY = 'colorThemePreference'; // ColorPaletteMaster の旧キー
  var ORDER = ['system', 'light', 'dark'];
  var LABEL = { system: 'システム', light: 'ライト', dark: 'ダーク' };

  var ICON = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="20" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };

  function readPref() {
    try {
      var v = localStorage.getItem(KEY);
      if (!v) {
        var old = localStorage.getItem(LEGACY_KEY);
        if (old && ORDER.indexOf(old) !== -1) {
          v = old;
          try { localStorage.setItem(KEY, v); } catch (e) {}
        }
      }
      return ORDER.indexOf(v) !== -1 ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function applyPref(pref) {
    var root = document.documentElement;
    if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
    else root.removeAttribute('data-theme'); // system = OS 設定に追従（common.css の @media）
  }

  var current = readPref();
  applyPref(current); // ← <body> 描画前に実行される

  function refreshButtons() {
    var btns = document.querySelectorAll('.yt-theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = ICON[current];
      btns[i].dataset.pref = current;
      btns[i].setAttribute('title', 'テーマ: ' + LABEL[current] + '（クリックで切替）');
      btns[i].setAttribute('aria-label', 'テーマを切り替え（現在: ' + LABEL[current] + '）');
    }
  }

  function setPref(pref) {
    if (ORDER.indexOf(pref) === -1) pref = 'system';
    current = pref;
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    applyPref(pref);
    refreshButtons();
  }

  function cyclePref() {
    setPref(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
  }

  window.YOSTheme = {
    get: function () { return current; },
    set: setPref,
    cycle: cyclePref
  };

  // 別タブ・別ツールでの変更を反映
  window.addEventListener('storage', function (e) {
    if (e.key && e.key !== KEY) return;
    var next = readPref();
    if (next === current) return;
    current = next;
    applyPref(current);
    refreshButtons();
  });

  function upgradeSlots() {
    var slots = document.querySelectorAll('[data-yos-theme-toggle]');
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      if (el.dataset.yttReady) continue;
      el.dataset.yttReady = '1';
      el.classList.add('yt-theme-toggle');
      if (el.tagName === 'BUTTON') el.type = 'button';
      el.addEventListener('click', function (ev) { ev.preventDefault(); cyclePref(); });
    }
    refreshButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', upgradeSlots);
  } else {
    upgradeSlots();
  }
})();
