// content-script.js
// Converted from Tampermonkey userscript -> Chrome extension content script (Manifest V3).
// Behavior should match the original script. Remote assets fetched from raw.githubusercontent.com.

// IIFE to avoid polluting page global scope
(async function () {
  'use strict';

  /**********************************************
   * CONFIG
   **********************************************/
  const STORAGE_KEY = 'cp_toolbox_snippets_vgm';
  const WIDTH_KEY = 'cp_toolbox_panel_width_vgm';

  // Remote resources (raw GitHub URLs provided by the user)
  const REMOTE_SNIPPETS_URL =
    'https://raw.githubusercontent.com/CodyGantCivic/code-snippets/main/snippet.json';

  const REMOTE_CSS_RAW =
    'https://raw.githubusercontent.com/CodyGantCivic/code-snippets/main/css/toolbox-overlay.css';

  const REMOTE_HTML_RAW =
    'https://raw.githubusercontent.com/CodyGantCivic/code-snippets/main/html/toolbox-overlay.html';

  const CIVICPLUS_SVG_RAW =
    'https://raw.githubusercontent.com/CodyGantCivic/code-snippets/main/assets/civicplus.svg';

  const DEFAULT_WIDTH = 420;
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 900;
  const ACCENT_RGB = 'rgb(204, 0, 32)';

  /**********************************************
   * chrome.storage wrappers (promisified)
   **********************************************/
  async function storageGet(key, fallback = null) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) {
            resolve(fallback);
            return;
          }
          if (result && result[key] !== undefined) resolve(result[key]);
          else resolve(fallback);
        });
      } catch (e) {
        resolve(fallback);
      }
    });
  }

  async function storageSet(key, value) {
    return new Promise((resolve, reject) => {
      try {
        const obj = {};
        obj[key] = value;
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function storageRemove(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove([key], () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  /**********************************************
   * clip helper: use navigator.clipboard when available, fallback to execCommand
   **********************************************/
  async function setClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // fall through to execCommand fallback
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      const sel = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ta);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      ta.remove();
      return ok;
    } catch (e) {
      console.warn('[CPToolbox] clipboard failed', e);
      return false;
    }
  }

  /**********************************************
   * tiny DOM helpers
   **********************************************/
  const create = (tag, attrs = {}, children = []) => {
    const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'style') Object.assign(el.style, attrs[k]);
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function')
        el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  };

  const uid = (p = 'id') => p + '-' + Math.random().toString(36).slice(2, 9);

  /**********************************************
   * remote fetch helper (uses fetch)
   **********************************************/
  async function loadRemoteText(url) {
    const urlWithBust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    try {
      const res = await fetch(urlWithBust, { cache: 'no-store' });
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      return await res.text();
    } catch (err) {
      throw err;
    }
  }

  /**********************************************
   * DEFAULT CSS fallback (used only if remote CSS fails)
   * NOTE: all classes prefixed with cptbx- to avoid collisions
   **********************************************/
  const FALLBACK_CSS = `
/* ===============================
   Design Tokens (Apple-style)
   =============================== */

:root {
  --bg: #ffffff;
  --bg-subtle: #f5f5f7;
  --border: #d2d2d7;
  --text: #1d1d1f;
  --muted: #6e6e73;
  --accent: #007aff;

  --radius-sm: 6px;
  --radius-md: 10px;

  --font: -apple-system, BlinkMacSystemFont,
          "SF Pro Text", "SF Pro Display",
          system-ui, sans-serif;
}

/* ===============================
   Panel
   =============================== */

#cp-toolbox-panel {
  position: fixed;
  inset: 0 auto 0 0;
  width: 420px;
  background: var(--bg);
  border-right: 1px solid var(--border);
  z-index: 2147483647;
  display: none;

  font-family: var(--font);
  color: var(--text);

  display: flex;
  flex-direction: column;
}

/* ===============================
   Header
   =============================== */

.cptbx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.cptbx-logo svg {
  height: 32px;
  width: auto;
}

/* ===============================
   Buttons
   =============================== */

.cptbx-actions {
  display: flex;
  gap: 8px;
}

.cptbx-btn {
  appearance: none;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  padding: 6px 12px;

  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
}

.cptbx-btn:hover {
  background: #eaeaed;
}

.cptbx-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.cptbx-primary:hover {
  filter: brightness(0.95);
}

/* ===============================
   Search
   =============================== */

.cptbx-search {
  display: flex;
  align-items: center;
  gap: 6px;

  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.cptbx-search input {
  flex: 1;
  padding: 8px 10px;
  font-size: 13px;

  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
}

.cptbx-search input:focus {
  outline: none;
  border-color: var(--accent);
  background: #fff;
}

.cptbx-clear-btn {
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--muted);
  cursor: pointer;
}

/* ===============================
   List
   =============================== */

.cptbx-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* Snippet Card */

.cptbx-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fff;
}

.cptbx-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cptbx-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.cptbx-copy {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  cursor: pointer;
}

.cptbx-copy:hover {
  background: #eaeaed;
}

/* Code Editor */

.cptbx-code {
  display: none;
  width: 100%;
  margin-top: 10px;
  padding: 8px;

  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;

  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
}

/* Actions */

.cptbx-actions,
.cptbx-actions button {
  font-size: 12px;
}

.cptbx-actions {
  display: none;
  margin-top: 8px;
  gap: 6px;
}

.cptbx-save,
.cptbx-edit,
.cptbx-delete {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  cursor: pointer;
}

.cptbx-delete {
  color: #c62828;
}

/* ===============================
   Footer
   =============================== */

.cptbx-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
}

.cptbx-footer input {
  margin-left: 6px;
  width: 80px;
}

/* ===============================
   Toast
   =============================== */

#cp-toolbox-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;

  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 8px 12px;
  border-radius: var(--radius-md);

  font-size: 13px;
  z-index: 2147483650;
}

`;

  /**********************************************
   * Insert CSS (fetch remote CSS, fallback to embedded)
   **********************************************/
  async function ensureCss() {
    // Avoid duplicating styles
    if (document.getElementById('cp-toolbox-styles')) return;
    try {
      const cssText = await loadRemoteText(REMOTE_CSS_RAW);
      if (typeof cssText === 'string' && cssText.trim().length > 0) {
        const s = create('style', { id: 'cp-toolbox-styles', html: cssText });
        document.head.appendChild(s);
        return;
      }
      throw new Error('empty CSS');
    } catch (err) {
      console.warn('[CPToolbox] Failed to load remote CSS, using fallback. Error:', err);
      const s = create('style', { id: 'cp-toolbox-styles', html: FALLBACK_CSS });
      document.head.appendChild(s);
    }
  }

  await ensureCss();

  /**********************************************
   * Build / Insert HTML UI (remote HTML or fallback)
   **********************************************/
  let panel = null;

  function createFallbackPanel() {
    const fallbackPanel = create('div', {
      id: 'cp-toolbox-panel',
      role: 'dialog',
      'aria-hidden': 'true'
    });

    // HEADER
    const header = create('div', { class: 'cptbx-header' });
    const logoWrap = create('div', { class: 'cptbx-logo', html: '<span style="font-size:12px; color:var(--cp-muted)">Loading logo…</span>' });
    const btnWrap = create('div', { class: 'cptbx-btns' });
    const addBtn = create('button', { class: 'cptbx-add-snippet-btn' }, ['+ Add Snippet']);
    addBtn.addEventListener('click', onAddSnippet);
    const refreshBtn = create('button', { class: 'cptbx-refresh-remote-btn' }, ['Refresh Remote']);
    refreshBtn.addEventListener('click', onRefreshRemote);
    btnWrap.appendChild(addBtn);
    btnWrap.appendChild(refreshBtn);
    header.appendChild(logoWrap);
    header.appendChild(btnWrap);
    fallbackPanel.appendChild(header);

    // SEARCH
    const searchRow = create('div', { class: 'cptbx-search-row' });
    const searchInputEl = create('input', { type: 'search', placeholder: 'Search title or code...' });
    const clearSearchBtn = create('button', { class: 'cptbx-clear-btn' }, ['Clear']);
    clearSearchBtn.addEventListener('click', () => { searchInputEl.value = ''; onSearch(); });
    searchRow.appendChild(searchInputEl);
    searchRow.appendChild(clearSearchBtn);
    fallbackPanel.appendChild(searchRow);

    // LIST
    const listWrapEl = create('div', { id: 'cp-list' });
    fallbackPanel.appendChild(listWrapEl);

    // FOOTER
    const footer = create('div', {
      style: {
        padding: '8px 4px',
        borderTop: '1px solid #f1f5f9',
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
      }
    }, [
      create('div', {}, ['Width:']),
      create('input', {
        type: 'number',
        value: DEFAULT_WIDTH,
        min: MIN_WIDTH,
        max: MAX_WIDTH,
        style: {
          width: '80px',
          padding: '6px',
          borderRadius: '6px',
          border: '1px solid #e6eef9'
        }
      })
    ]);
    footer.querySelector('input').addEventListener('change', async function () {
      let v = parseInt(this.value, 10);
      if (isNaN(v)) v = DEFAULT_WIDTH;
      v = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
      fallbackPanel.style.width = v + 'px';
      await storageSet(WIDTH_KEY, v);
    });
    fallbackPanel.appendChild(footer);

    document.body.appendChild(fallbackPanel);
    return fallbackPanel;
  }

  async function buildPanelFromRemote() {
    try {
      const htmlText = await loadRemoteText(REMOTE_HTML_RAW);
      if (typeof htmlText !== 'string' || !htmlText.trim()) throw new Error('empty HTML');
      const wrapper = create('div', { html: htmlText });
      const foundPanel = wrapper.querySelector('#cp-toolbox-panel') || wrapper.firstElementChild;
      if (!foundPanel) throw new Error('no root panel found in remote HTML');

      if (!document.getElementById('cp-toolbox-panel')) {
        if (!foundPanel.id) foundPanel.id = 'cp-toolbox-panel';
        document.body.appendChild(foundPanel.cloneNode(true));
      } else {
        const existing = document.getElementById('cp-toolbox-panel');
        existing.innerHTML = foundPanel.innerHTML;
      }

      const docPanel = document.getElementById('cp-toolbox-panel');
      if (!docPanel) throw new Error('failed to append remote panel');
      return docPanel;
    } catch (err) {
      console.warn('[CPToolbox] Failed to load remote HTML - falling back. Error:', err);
      return null;
    }
  }

  panel = await buildPanelFromRemote();
  if (!panel) panel = createFallbackPanel();

  /**********************************************
   * After panel exists in DOM, find commonly used elements
   **********************************************/
  function firstMatch(container, selectors) {
    for (const s of selectors) {
      const el = container.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  let logoWrap = firstMatch(panel, ['.cptbx-logo', '.cp-logo', '#logo', '.logo']);
  if (!logoWrap) {
    logoWrap = create('div', { class: 'cptbx-logo', html: '<span style="font-size:12px; color:var(--cp-muted)">Loading logo…</span>' });
    const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']);
    if (headerEl) headerEl.insertBefore(logoWrap, headerEl.firstChild);
    else panel.insertBefore(logoWrap, panel.firstChild);
  }

  let addBtn = firstMatch(panel, ['.cptbx-add-snippet-btn', '.add-snippet-btn', '#add-snippet-btn', 'button.add-snippet']);
  if (!addBtn) {
    addBtn = create('button', { class: 'cptbx-add-snippet-btn' }, ['+ Add Snippet']);
    const btnsWrap = firstMatch(panel, ['.cptbx-btns', '.btns', '.header .btns', '.actions']);
    if (btnsWrap) btnsWrap.appendChild(addBtn);
    else {
      const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']);
      const wrap = create('div', { class: 'cptbx-btns' });
      wrap.appendChild(addBtn);
      if (headerEl) headerEl.appendChild(wrap);
      else panel.appendChild(wrap);
    }
  }
  addBtn.addEventListener('click', onAddSnippet);

  let refreshBtn = firstMatch(panel, ['.cptbx-refresh-remote-btn', '.refresh-remote-btn', '#refresh-remote-btn', 'button.refresh-remote']);
  if (!refreshBtn) {
    refreshBtn = create('button', { class: 'cptbx-refresh-remote-btn' }, ['Refresh Remote']);
    addBtn.parentElement.appendChild(refreshBtn);
  }
  refreshBtn.addEventListener('click', onRefreshRemote);

  (function setupBtnDropdown() {
    let btnsContainer = firstMatch(panel, ['.cptbx-btns', '.btns', '#cp-btns', '.header .btns']);
    if (!btnsContainer && addBtn && addBtn.parentElement) btnsContainer = addBtn.parentElement;
    if (!btnsContainer) {
      const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']) || panel;
      btnsContainer = create('div', { class: 'cptbx-btns' });
      headerEl.appendChild(btnsContainer);
    }

    let headerArea = btnsContainer.querySelector('.btns-header');
    let dropdown = btnsContainer.querySelector('.btns-dropdown');

    if (!dropdown) {
      dropdown = create('div', { class: 'btns-dropdown', 'aria-hidden': 'true', role: 'menu' });
      const candidates = [];
      if (addBtn) candidates.push(addBtn);
      if (refreshBtn) candidates.push(refreshBtn);
      btnsContainer.querySelectorAll('button').forEach((b) => {
        if (!candidates.includes(b)) candidates.push(b);
      });
      candidates.forEach((b) => {
        b.setAttribute('role', 'menuitem');
        dropdown.appendChild(b);
      });
      headerArea = btnsContainer.querySelector('.btns-header') || create('div', { class: 'btns-header', tabindex: '0', 'aria-expanded': 'false', 'aria-controls': 'cptbx-btns-dropdown' }, ['Actions ', create('span', { class: 'chev', 'aria-hidden': 'true' }, ['▾'])]);
      if (!dropdown.id) dropdown.id = 'cptbx-btns-dropdown';
      btnsContainer.innerHTML = '';
      btnsContainer.appendChild(headerArea);
      btnsContainer.appendChild(dropdown);
    } else {
      if (!headerArea) {
        headerArea = create('div', { class: 'btns-header', tabindex: '0', 'aria-expanded': 'false', 'aria-controls': dropdown.id || 'cptbx-btns-dropdown' }, ['Actions ', create('span', { class: 'chev', 'aria-hidden': 'true' }, ['▾'])]);
        btnsContainer.insertBefore(headerArea, dropdown);
      }
      if (!dropdown.id) dropdown.id = 'cptbx-btns-dropdown';
      dropdown.setAttribute('aria-hidden', dropdown.style.display === 'flex' ? 'false' : 'true');
      headerArea.setAttribute('aria-expanded', dropdown.style.display === 'flex' ? 'true' : 'false');
      headerArea.setAttribute('tabindex', headerArea.getAttribute('tabindex') || '0');
    }

    btnsContainer.setAttribute('role', btnsContainer.getAttribute('role') || 'group');
    headerArea.setAttribute('role', headerArea.getAttribute('role') || 'button');

    function openDropdown() {
      btnsContainer.classList.add('open');
      dropdown.style.display = 'flex';
      dropdown.style.flexDirection = 'column';
      dropdown.setAttribute('aria-hidden', 'false');
      headerArea.setAttribute('aria-expanded', 'true');
      const firstBtn = dropdown.querySelector('button, [role="menuitem"]');
      if (firstBtn) firstBtn.focus();
    }
    function closeDropdown() {
      btnsContainer.classList.remove('open');
      dropdown.style.display = 'none';
      dropdown.setAttribute('aria-hidden', 'true');
      headerArea.setAttribute('aria-expanded', 'false');
      headerArea.focus({ preventScroll: true });
    }
    function toggleDropdown() {
      const isOpen = btnsContainer.classList.contains('open');
      if (isOpen) closeDropdown();
      else openDropdown();
    }

    if (!btnsContainer.classList.contains('open')) {
      dropdown.style.display = 'none';
      dropdown.setAttribute('aria-hidden', 'true');
      headerArea.setAttribute('aria-expanded', 'false');
    }

    headerArea.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDropdown();
    });

    headerArea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggleDropdown();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        openDropdown();
      } else if (ev.key === 'Escape') {
        if (btnsContainer.classList.contains('open')) {
          ev.preventDefault();
          closeDropdown();
        }
      }
    });

    document.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!btnsContainer.contains(target) && btnsContainer.classList.contains('open')) {
        closeDropdown();
      }
    }, true);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && btnsContainer.classList.contains('open')) {
        closeDropdown();
      }
    });

    dropdown.addEventListener('click', (ev) => {
      if (ev.target && (ev.target.tagName === 'BUTTON' || ev.target.closest('button'))) {
        ev.stopPropagation();
      }
    });

    if (addBtn) {
      addBtn.removeEventListener('click', onAddSnippet);
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onAddSnippet();
      });
    }
    if (refreshBtn) {
      refreshBtn.removeEventListener('click', onRefreshRemote);
      refreshBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onRefreshRemote();
      });
    }
  })();

  let searchInput = firstMatch(panel, [
    'input[type="search"]',
    '#cp-search',
    '.cptbx-search-row input',
    '.search-row input',
    '.search input'
  ]);
  let clearSearchBtn = firstMatch(panel, [
    '.cptbx-clear-btn',
    '.clear-btn',
    '#clear-search',
    '.search-row .clear-btn'
  ]);
  if (!searchInput) {
    const searchRow = create('div', { class: 'cptbx-search-row' });
    searchInput = create('input', { type: 'search', placeholder: 'Search title or code...' });
    clearSearchBtn = create('button', { class: 'cptbx-clear-btn' }, ['Clear']);
    clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; onSearch(); });
    searchRow.appendChild(searchInput);
    searchRow.appendChild(clearSearchBtn);
    const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']);
    if (headerEl && headerEl.parentElement === panel) panel.insertBefore(searchRow, headerEl.nextSibling);
    else panel.insertBefore(searchRow, panel.firstChild);
  } else {
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; onSearch(); });
    } else {
      let siblingBtn = searchInput.parentElement ? searchInput.parentElement.querySelector('.cptbx-clear-btn, .clear-btn') : null;
      if (!siblingBtn) {
        siblingBtn = create('button', { class: 'cptbx-clear-btn' }, ['Clear']);
        searchInput.parentElement && searchInput.parentElement.appendChild(siblingBtn);
      }
      siblingBtn.addEventListener('click', () => { searchInput.value = ''; onSearch(); });
      clearSearchBtn = siblingBtn;
    }
  }

  let listWrap = firstMatch(panel, ['#cp-list', '.cptbx-list', '.cp-list', '#list', '.list']);
  if (!listWrap) {
    listWrap = create('div', { id: 'cp-list' });
    const searchRow = firstMatch(panel, ['.cptbx-search-row', '.search-row', '#search-row']);
    if (searchRow && searchRow.parentElement === panel) panel.insertBefore(listWrap, searchRow.nextSibling);
    else panel.appendChild(listWrap);
  }

  let footerWidthInput = firstMatch(panel, ['input[type="number"]', '#cp-width-input', '.panel-width input']);
  if (footerWidthInput) {
    footerWidthInput.addEventListener('change', async function () {
      let v = parseInt(this.value, 10);
      if (isNaN(v)) v = DEFAULT_WIDTH;
      v = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
      panel.style.width = v + 'px';
      await storageSet(WIDTH_KEY, v);
    });
  } else {
    const footer = create('div', {
      style: {
        padding: '8px 4px',
        borderTop: '1px solid #f1f5f9',
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
      }
    }, [
      create('div', {}, ['Width:']),
      create('input', {
        type: 'number',
        value: DEFAULT_WIDTH,
        min: MIN_WIDTH,
        max: MAX_WIDTH,
        style: {
          width: '80px',
          padding: '6px',
          borderRadius: '6px',
          border: '1px solid #e6eef9'
        }
      })
    ]);
    footer.querySelector('input').addEventListener('change', async function () {
      let v = parseInt(this.value, 10);
      if (isNaN(v)) v = DEFAULT_WIDTH;
      v = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
      panel.style.width = v + 'px';
      await storageSet(WIDTH_KEY, v);
    });
    panel.appendChild(footer);
  }

  /**********************************************
   * SVG logo loader
   **********************************************/
  async function loadRemoteSvgIntoLogo(url, logoElement) {
    try {
      const svgText = await loadRemoteText(url);
      if (typeof svgText === 'string' && svgText.trim().toLowerCase().includes('<svg')) {
        let finalSvg = svgText;
        finalSvg = finalSvg.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
          if (!/aria-hidden=/i.test(attrs)) attrs += ' aria-hidden="true"';
          if (!/role=/i.test(attrs)) attrs += ' role="img"';
          return '<svg' + attrs + '>';
        });
        logoElement.innerHTML = finalSvg;
        return;
      }
      logoElement.innerHTML = '<span style="font-size:12px; color:var(--cp-muted)">Logo unavailable</span>';
    } catch (err) {
      console.warn('[CPToolbox] Failed to load logo SVG:', err);
      logoElement.innerHTML = '<span style="font-size:12px; color:var(--cp-muted)">Logo load failed</span>';
    }
  }
  if (logoWrap) loadRemoteSvgIntoLogo(CIVICPLUS_SVG_RAW, logoWrap);

  /**********************************************
   * STATE
   **********************************************/
  let scripts = [];
  let panelVisible = false;

  /**********************************************
   * LOAD LOCAL STATE
   **********************************************/
  async function loadState() {
    try {
      const raw = await storageGet(STORAGE_KEY, '[]');
      const parsed = JSON.parse(raw || '[]');
      scripts = Array.isArray(parsed) ? parsed : [];
    } catch {
      scripts = [];
    }

    try {
      const w = await storageGet(WIDTH_KEY, DEFAULT_WIDTH);
      panel.style.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)) + 'px';
      const widthInput = firstMatch(panel, ['input[type="number"]', '#cp-width-input', '.panel-width input']);
      if (widthInput) widthInput.value = panel.style.width.replace('px', '') || DEFAULT_WIDTH;
    } catch {
      panel.style.width = DEFAULT_WIDTH + 'px';
    }
  }

  /**********************************************
   * RENDER LIST (with search filter)
   **********************************************/
  function clearList() {
    listWrap.innerHTML = '';
  }

  function makeItem(snippet) {
    const item = create('div', { class: 'cptbx-item', 'data-id': snippet.id });

    const row = create('div', { class: 'cptbx-row' });
    const title = create('div', { class: 'cptbx-title' }, [snippet.title || '(untitled)']);

    title.onclick = () => toggleExpand();
    title.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpand();
      }
    };

    const copyBtn = create('button', { class: 'cptbx-copy' }, ['Copy']);
    copyBtn.onclick = async () => {
      try {
        const ok = await setClipboard(snippet.code || '');
        if (ok) showToast('Copied!');
        else showToast('Copy failed');
      } catch (err) {
        console.warn('copy failed', err);
        showToast('Copy failed');
      }
    };

    row.appendChild(title);
    row.appendChild(copyBtn);

    const codeArea = create('textarea', { class: 'cptbx-code', spellcheck: 'false' });
    codeArea.value = snippet.code || '';

    const actions = create('div', { class: 'cptbx-actions' });
    const saveBtn = create('button', { class: 'cptbx-save' }, ['Save']);
    const editBtn = create('button', { class: 'cptbx-edit' }, ['Edit']);
    const deleteBtn = create('button', { class: 'cptbx-delete' }, ['Delete']);
    const charCount = create('div', { class: 'cptbx-char' }, [`Chars: ${codeArea.value.length}`]);

    actions.appendChild(saveBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(charCount);

    codeArea.oninput = () => {
      charCount.textContent = 'Chars: ' + codeArea.value.length;
    };

    saveBtn.onclick = async () => {
      snippet.code = codeArea.value;
      snippet.localEdited = true;

      try {
        const raw = await storageGet(STORAGE_KEY, '[]');
        let stored = [];
        try { stored = JSON.parse(raw || '[]'); } catch { stored = []; }

        const idx = stored.findIndex((s) => s.id === snippet.id);
        const copy = {
          id: snippet.id,
          title: snippet.title,
          code: snippet.code,
          localEdited: true
        };

        if (idx === -1) stored.push(copy);
        else stored[idx] = copy;

        await storageSet(STORAGE_KEY, JSON.stringify(stored));
        showToast('Saved locally');
      } catch {
        showToast('Local Save Failed');
      }
    };

    editBtn.onclick = async () => {
      const newTitle = prompt('Edit snippet title:', snippet.title || '');
      if (newTitle === null) return;
      snippet.title = newTitle.trim() || snippet.title;
      codeArea.style.display = 'block';
      actions.style.display = 'flex';
      codeArea.focus();
      try {
        const raw = await storageGet(STORAGE_KEY, '[]');
        let stored = [];
        try { stored = JSON.parse(raw || '[]'); } catch { stored = []; }
        const idx = stored.findIndex((s) => s.id === snippet.id);
        if (idx === -1) {
          stored.push({ id: snippet.id, title: snippet.title, code: snippet.code || '', localEdited: true });
        } else {
          stored[idx].title = snippet.title;
        }
        await storageSet(STORAGE_KEY, JSON.stringify(stored));
      } catch (err) {
        console.warn('persist title failed', err);
      }
      title.textContent = snippet.title;
      showToast('Title updated');
    };

    deleteBtn.onclick = async () => {
      const ok = confirm(`Delete snippet "${snippet.title || '(untitled)'}"? This cannot be undone.`);
      if (!ok) return;
      scripts = scripts.filter((s) => s.id !== snippet.id);
      try {
        const raw = await storageGet(STORAGE_KEY, '[]');
        let stored = [];
        try { stored = JSON.parse(raw || '[]'); } catch { stored = []; }
        stored = stored.filter((s) => s.id !== snippet.id);
        await storageSet(STORAGE_KEY, JSON.stringify(stored));
      } catch (err) {
        console.warn('remove from storage failed', err);
      }
      renderList(searchInput?.value || '');
      showToast('Deleted');
    };

    function toggleExpand() {
      const expanded = codeArea.style.display === 'block';
      codeArea.style.display = expanded ? 'none' : 'block';
      actions.style.display = expanded ? 'none' : 'flex';
    }

    item.appendChild(row);
    item.appendChild(codeArea);
    item.appendChild(actions);

    return item;
  }

  function renderList(filter = '') {
    clearList();

    const q = (filter || '').trim().toLowerCase();
    const filtered = scripts.filter((snip) => {
      if (!q) return true;
      const t = (snip.title || '').toLowerCase();
      const c = (snip.code || '').toLowerCase();
      return t.includes(q) || c.includes(q);
    });

    if (filtered.length === 0) {
      listWrap.appendChild(
        create('div', {
          style: { padding: '12px', color: '#667085' }
        }, ['No snippets match — try a different search or click "Refresh Remote".'])
      );
      return;
    }

    filtered.forEach((snip) => {
      listWrap.appendChild(makeItem(snip));
    });
  }

  /**********************************************
   * SEARCH handling
   **********************************************/
  function onSearch() {
    const q = (searchInput && searchInput.value) || '';
    renderList(q);
  }
  if (searchInput) searchInput.addEventListener('input', onSearch);

  /**********************************************
   * ADD SNIPPET (LOCAL)
   **********************************************/
  async function onAddSnippet() {
    const title = prompt('Snippet Title:');
    if (!title) return;

    const code = prompt('Paste snippet code:') || '';
    const snip = {
      id: uid('snip'),
      title,
      code,
      expanded: false,
      localEdited: true
    };

    scripts.push(snip);
    await saveState();
    renderList((searchInput && searchInput.value) || '');
    showToast('Added local snippet');
  }

  /**********************************************
   * REFRESH REMOTE (using fetch)
   **********************************************/
  async function onRefreshRemote() {
    showToast('Loading remote snippets…');

    async function fetchJson(url) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return { ok: false, status: res.status };
        const data = await res.json();
        return { ok: true, data };
      } catch (err) {
        return { ok: false, err };
      }
    }

    const r = await fetchJson(REMOTE_SNIPPETS_URL);
    if (!r.ok || !Array.isArray(r.data)) {
      showToast('Failed to load remote JSON');
      console.error('[CPToolbox] remote load failed:', r);
      return;
    }
    const remote = r.data;

    let persisted = [];
    try {
      const raw = await storageGet(STORAGE_KEY, '[]');
      persisted = JSON.parse(raw || '[]') || [];
    } catch (e) {
      persisted = [];
    }

    const persistedIds = new Set((persisted || []).map((s) => s && s.id).filter(Boolean));

    const normalizedRemote = (remote || []).map((it, i) => ({
      id: typeof it.id === 'string' ? it.id : 'remote-' + i,
      title: typeof it.title === 'string' ? it.title : 'Remote Snippet ' + (i + 1),
      code: typeof it.code === 'string' ? it.code : '',
      expanded: false,
      remoteSource: REMOTE_SNIPPETS_URL,
      localEdited: false
    }));

    const merged = Array.isArray(persisted) ? persisted.slice() : [];
    normalizedRemote.forEach((rItem) => {
      if (!persistedIds.has(rItem.id)) merged.push(rItem);
    });

    scripts = merged;
    try {
      await storageSet(STORAGE_KEY, JSON.stringify(scripts));
      showToast(`Merged ${scripts.length} snippets (local + remote)`);
    } catch (err) {
      console.error('[CPToolbox] failed to save merged snippets', err);
      showToast('Failed to persist merged snippets');
    }

    renderList((searchInput && searchInput.value) || '');
  }

  /**********************************************
   * UI CONTROLS (Width, Toggle)
   **********************************************/
  async function saveState() {
    await storageSet(STORAGE_KEY, JSON.stringify(scripts));
  }

  function openPanel() {
    panel.style.display = 'block';
    panelVisible = true;
  }
  function closePanel() {
    panel.style.display = 'none';
    panelVisible = false;
  }
  function togglePanel() {
    panelVisible ? closePanel() : openPanel();
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      togglePanel();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      togglePanel();
    }
  });

  /**********************************************
   * TOAST
   **********************************************/
  let toastTimer = null;
  function showToast(msg) {
    let t = document.getElementById('cp-toolbox-toast');
    if (!t) {
      t = create('div', {
        id: 'cp-toolbox-toast',
        style: {}
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 1600);
  }

  /**********************************************
   * INIT
   **********************************************/
  await loadState();
  renderList((searchInput && searchInput.value) || '');

  console.log('[CPToolbox] Ready — Edit/Delete added. Toggle with Ctrl+RightClick.');
})();
