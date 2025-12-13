// content-script.js
// Converted from Tampermonkey userscript -> Chrome extension content script (Manifest V3).
// Behavior should match the original script while loading assets packaged with the extension.

// IIFE to avoid polluting page global scope
(async function () {
  'use strict';

  /**********************************************
   * CONFIG
   **********************************************/
  const STORAGE_KEY = 'cp_toolbox_snippets_vgm';
  const WIDTH_KEY = 'cp_toolbox_panel_width_vgm';

  // Local (packaged) resources
  const extUrl = (path) => (chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : path);
  const LOCAL_SNIPPETS_URL = extUrl('snippet.json');
  const LOCAL_CSS_URL = extUrl('css/toolbox-overlay.css');
  const LOCAL_HTML_URL = extUrl('html/toolbox-overlay.html');
  const CIVICPLUS_SVG_URL = extUrl('assets/civicplus.svg');

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
   * local fetch helper (uses fetch against packaged assets)
   **********************************************/
  async function loadLocalText(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      return await res.text();
    } catch (err) {
      throw err;
    }
  }

  /**********************************************
   * FALLBACK CSS (Apple-like) + palette styles
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

.cptbx-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cptbx-mark {
  font-size: 16px;
  color: var(--accent);
}
.cptbx-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
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
  display: inline-flex;
  align-items: center;
}
.cptbx-btn i { font-size: 12px; margin-right: 8px; opacity: 0.9; }

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
   Palette (Command Palette)
   =============================== */

.cptbx-palette {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 70px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.08);
  z-index: 2147483700;
  display: none;
  max-height: 56vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.cptbx-palette-input {
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
.cptbx-palette-input input {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  font-size: 14px;
  outline: none;
}

.cptbx-palette-list {
  overflow-y: auto;
  max-height: calc(56vh - 56px);
}

.cptbx-palette-item {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  gap: 10px;
  align-items: center;
  border-bottom: 1px solid rgba(0,0,0,0.03);
}
.cptbx-palette-item:last-child { border-bottom: none; }
.cptbx-palette-item .label { flex: 1; font-size: 13px; color: var(--text); }
.cptbx-palette-item .muted { font-size: 12px; color: var(--muted); }
.cptbx-palette-item.is-active { background: #f2f4f8; }

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

/* Simple icon fallbacks so we don't depend on Font Awesome */
.fa-solid { font-style: normal; font-weight: 700; }
.fa-solid::before { display: inline-block; }
.fa-code::before { content: '</>'; }
.fa-arrow-rotate-right::before { content: 'R'; }
.fa-plus::before { content: '+'; }
.fa-magnifying-glass::before { content: '?'; }
.fa-xmark::before { content: 'x'; }
.fa-arrows-left-right::before { content: '<>'; }
.cptbx-search i { font-size: 12px; color: var(--muted); margin-right: 6px; }
`;

  /**********************************************
   * Ensure Font Awesome is loaded (if user requested icons)
   **********************************************/
  /**********************************************
   * Insert CSS (fetch bundled CSS, fallback to embedded)
  **********************************************/
  async function ensureCss() {
    // Avoid duplicating styles
    if (document.getElementById('cp-toolbox-styles')) return;
    try {
      const cssText = await loadLocalText(LOCAL_CSS_URL);
      if (typeof cssText === 'string' && cssText.trim().length > 0) {
        const s = create('style', { id: 'cp-toolbox-styles', html: cssText });
        document.head.appendChild(s);
        return;
      }
      throw new Error('empty CSS');
    } catch (err) {
      console.warn('[CPToolbox] Failed to load bundled CSS, using fallback. Error:', err);
      const s = create('style', { id: 'cp-toolbox-styles', html: FALLBACK_CSS });
      document.head.appendChild(s);
    }
  }

  await ensureCss();

  /**********************************************
   * Build / Insert HTML UI (bundled HTML or fallback)
   **********************************************/
  let panel = null;

  function createFallbackPanel() {
    const fallbackPanel = create('div', {
      id: 'cp-toolbox-panel',
      role: 'dialog',
      'aria-hidden': 'true'
    });

    // HEADER (Apple-style default)
    const header = create('div', { class: 'cptbx-header' });
    const brand = create('div', { class: 'cptbx-brand', html: '<span class="cptbx-mark">&lt;/&gt;</span><span class="cptbx-name">Snippet Box</span>' });
    const btnWrap = create('div', { class: 'cptbx-actions' });
    const refreshBtn = create('button', { class: 'cptbx-btn cptbx-secondary cptbx-refresh-snippets-btn cptbx-refresh-remote-btn' }, [create('span', { html: 'Refresh Snippets' })]);
    refreshBtn.addEventListener('click', onRefreshSnippets);
    const addBtn = create('button', { class: 'cptbx-btn cptbx-primary cptbx-add-snippet-btn' }, [create('span', { html: 'Add' })]);
    addBtn.addEventListener('click', onAddSnippet);
    btnWrap.appendChild(refreshBtn);
    btnWrap.appendChild(addBtn);
    header.appendChild(brand);
    header.appendChild(btnWrap);
    fallbackPanel.appendChild(header);

    // SEARCH
    const searchRow = create('div', { class: 'cptbx-search' });
    const searchIcon = create('i', { class: 'fa-solid fa-magnifying-glass', 'aria-hidden': 'true' });
    const searchInputEl = create('input', { type: 'search', placeholder: 'Search title or code...' });
    const clearSearchBtn = create('button', { class: 'cptbx-clear-btn' }, [create('span', { html: 'Clear' })]);
    clearSearchBtn.addEventListener('click', () => { searchInputEl.value = ''; onSearch(); });
    searchRow.appendChild(searchIcon);
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

    // palette (hidden by default)
    const palette = createPaletteElement();
    fallbackPanel.appendChild(palette);

    document.body.appendChild(fallbackPanel);
    return fallbackPanel;
  }

  async function buildPanelFromLocalHtml() {
    try {
      const htmlText = await loadLocalText(LOCAL_HTML_URL);
      if (typeof htmlText !== 'string' || !htmlText.trim()) throw new Error('empty HTML');
      const wrapper = create('div', { html: htmlText });
      const foundPanel = wrapper.querySelector('#cp-toolbox-panel') || wrapper.firstElementChild;
      if (!foundPanel) throw new Error('no root panel found in bundled HTML');

      if (!document.getElementById('cp-toolbox-panel')) {
        if (!foundPanel.id) foundPanel.id = 'cp-toolbox-panel';
        document.body.appendChild(foundPanel.cloneNode(true));
      } else {
        const existing = document.getElementById('cp-toolbox-panel');
        existing.innerHTML = foundPanel.innerHTML;
      }

      const docPanel = document.getElementById('cp-toolbox-panel');
      if (!docPanel) throw new Error('failed to append bundled panel');

      // ensure palette exists (in case bundled HTML doesn't include it)
      if (!docPanel.querySelector('.cptbx-palette')) {
        const palette = createPaletteElement();
        docPanel.appendChild(palette);
      }

      return docPanel;
    } catch (err) {
      console.warn('[CPToolbox] Failed to load bundled HTML - falling back. Error:', err);
      return null;
    }
  }

  panel = await buildPanelFromLocalHtml();
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

  let logoWrap = firstMatch(panel, ['.cptbx-logo', '.cp-logo', '#logo', '.logo', '.cptbx-brand']);
  if (!logoWrap) {
    logoWrap = create('div', { class: 'cptbx-logo', html: '<span style="font-size:12px; color:var(--cp-muted)">Loading logo...</span>' });
    const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']);
    if (headerEl) headerEl.insertBefore(logoWrap, headerEl.firstChild);
    else panel.insertBefore(logoWrap, panel.firstChild);
  }

  // Buttons: find add & refresh
  let addBtn = firstMatch(panel, ['.cptbx-add-snippet-btn', '.add-snippet-btn', '#add-snippet-btn', 'button.add-snippet']);
  if (!addBtn) {
    addBtn = create('button', { class: 'cptbx-add-snippet-btn' }, ['+ Add Snippet']);
    const btnsWrap = firstMatch(panel, ['.cptbx-btns', '.btns', '.header .btns', '.actions', '.cptbx-actions']);
    if (btnsWrap) btnsWrap.appendChild(addBtn);
    else {
      const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']);
      const wrap = create('div', { class: 'cptbx-btns' });
      wrap.appendChild(addBtn);
      if (headerEl) headerEl.appendChild(wrap);
      else panel.appendChild(wrap);
    }
  }
  addBtn.removeEventListener && addBtn.removeEventListener('click', onAddSnippet);
  addBtn.addEventListener('click', onAddSnippet);

  let refreshBtn = firstMatch(panel, [
    '.cptbx-refresh-snippets-btn',
    '.cptbx-refresh-remote-btn',
    '.refresh-remote-btn',
    '#refresh-remote-btn',
    'button.refresh-remote'
  ]);
  if (!refreshBtn) {
    refreshBtn = create('button', { class: 'cptbx-refresh-snippets-btn cptbx-refresh-remote-btn' }, ['Refresh Snippets']);
    addBtn.parentElement && addBtn.parentElement.appendChild(refreshBtn);
  }
  refreshBtn.removeEventListener && refreshBtn.removeEventListener('click', onRefreshSnippets);
  refreshBtn.addEventListener('click', onRefreshSnippets);

  /**********************************************
   * Keep older dropdown setup for compatibility,
   * but bundled Apple-style UI won't use it.
   **********************************************/
  (function setupBtnDropdown() {
    // maintain compatibility with various HTML template shapes
    let btnsContainer = firstMatch(panel, ['.cptbx-btns', '.btns', '#cp-btns', '.header .btns', '.cptbx-actions']);
    if (!btnsContainer && addBtn && addBtn.parentElement) btnsContainer = addBtn.parentElement;
    if (!btnsContainer) {
      const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']) || panel;
      btnsContainer = create('div', { class: 'cptbx-btns' });
      headerEl.appendChild(btnsContainer);
    }

    // If the layout already puts buttons where we want, just return
    // (we only need dropdown behavior on legacy templates)
    // For Apple style, leave as-is.
  })();

  // SEARCH input and clear button selectors should include the new class
  let searchInput = firstMatch(panel, [
    'input[type="search"]',
    '#cp-search',
    '.cptbx-search input',
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
    // create a minimal search row at top under header
    const searchRow = create('div', { class: 'cptbx-search' });
    searchInput = create('input', { type: 'search', placeholder: 'Search title or code...' });
    clearSearchBtn = create('button', { class: 'cptbx-clear-btn' }, ['Clear']);
    clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; onSearch(); });
    searchRow.appendChild(searchInput);
    searchRow.appendChild(clearSearchBtn);
    // insert after header if header exists
    const headerEl = firstMatch(panel, ['.cptbx-header', '.header', 'header']);
    if (headerEl && headerEl.parentElement === panel) panel.insertBefore(searchRow, headerEl.nextSibling);
    else panel.insertBefore(searchRow, panel.firstChild);
  } else {
    // ensure clear button has handler
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; onSearch(); });
    } else {
      // try to locate a sibling button; if none, create one and insert after input
      let siblingBtn = searchInput.parentElement ? searchInput.parentElement.querySelector('.cptbx-clear-btn, .clear-btn') : null;
      if (!siblingBtn) {
        siblingBtn = create('button', { class: 'cptbx-clear-btn' }, ['Clear']);
        searchInput.parentElement && searchInput.parentElement.appendChild(siblingBtn);
      }
      siblingBtn.addEventListener('click', () => { searchInput.value = ''; onSearch(); });
      clearSearchBtn = siblingBtn;
    }
  }

  // LIST container
  let listWrap = firstMatch(panel, ['#cp-list', '.cptbx-list', '.cp-list', '#list', '.list']);
  if (!listWrap) {
    listWrap = create('div', { id: 'cp-list' });
    const searchRow = firstMatch(panel, ['.cptbx-search', '.cptbx-search-row', '.search-row', '#search-row']);
    if (searchRow && searchRow.parentElement === panel) panel.insertBefore(listWrap, searchRow.nextSibling);
    else panel.appendChild(listWrap);
  }

  // FOOTER width input
  let footerWidthInput = firstMatch(panel, ['.cptbx-footer input[type="number"]', 'input[type="number"]', '#cp-width-input', '.panel-width input']);
  if (footerWidthInput) {
    footerWidthInput.addEventListener('change', async function () {
      let v = parseInt(this.value, 10);
      if (isNaN(v)) v = DEFAULT_WIDTH;
      v = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
      panel.style.width = v + 'px';
      await storageSet(WIDTH_KEY, v);
    });
  } else {
    // If none in bundled HTML, create a tiny footer control if missing
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
  async function loadSvgIntoLogo(url, logoElement) {
    try {
      const svgText = await loadLocalText(url);
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
  if (logoWrap) loadSvgIntoLogo(CIVICPLUS_SVG_URL, logoWrap);

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
      const widthInput = firstMatch(panel, ['.cptbx-footer input[type="number"]', 'input[type="number"]', '#cp-width-input', '.panel-width input']);
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
    const title = create('div', { class: 'cptbx-title', tabindex: 0 }, [snippet.title || '(untitled)']);

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
        }, ['No snippets match - try a different search or click "Refresh Snippets".'])
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
   * REFRESH SNIPPETS (from packaged JSON)
   **********************************************/
  async function onRefreshSnippets() {
    showToast('Loading bundled snippets...');

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

    const r = await fetchJson(LOCAL_SNIPPETS_URL);
    if (!r.ok || !Array.isArray(r.data)) {
      showToast('Failed to load bundled JSON');
      console.error('[CPToolbox] bundled load failed:', r);
      return;
    }
    const bundled = r.data;

    let persisted = [];
    try {
      const raw = await storageGet(STORAGE_KEY, '[]');
      persisted = JSON.parse(raw || '[]') || [];
    } catch (e) {
      persisted = [];
    }

    const persistedIds = new Set((persisted || []).map((s) => s && s.id).filter(Boolean));

    const normalizedBundled = (bundled || []).map((it, i) => ({
      id: typeof it.id === 'string' ? it.id : 'bundle-' + i,
      title: typeof it.title === 'string' ? it.title : 'Snippet ' + (i + 1),
      code: typeof it.code === 'string' ? it.code : '',
      expanded: false,
      source: LOCAL_SNIPPETS_URL,
      localEdited: false
    }));

    const merged = Array.isArray(persisted) ? persisted.slice() : [];
    normalizedBundled.forEach((rItem) => {
      if (!persistedIds.has(rItem.id)) merged.push(rItem);
    });

    scripts = merged;
    try {
      await storageSet(STORAGE_KEY, JSON.stringify(scripts));
      showToast(`Merged ${scripts.length} snippets (local + bundled)`);
    } catch (err) {
      console.error('[CPToolbox] failed to save merged snippets', err);
      showToast('Failed to persist merged snippets');
    }

    renderList((searchInput && searchInput.value) || '');
    // refresh palette results if open
    refreshPaletteResults();
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
    closePalette();
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
    // Command/Ctrl + K opens command palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePalette();
    }
  });

  /**********************************************
   * Command Palette Implementation
   **********************************************/
  // palette state & elements
  let paletteEl = null;
  let paletteInput = null;
  let paletteList = null;
  let paletteOpen = false;
  let paletteResults = [];
  let paletteActiveIndex = -1;

  function createPaletteElement() {
    const wrap = create('div', { class: 'cptbx-palette', 'aria-hidden': 'true' });
    const inputRow = create('div', { class: 'cptbx-palette-input' });
    const input = create('input', { type: 'text', placeholder: 'Search commands and snippets...', 'aria-label': 'Command palette' });
    inputRow.appendChild(input);
    const list = create('div', { class: 'cptbx-palette-list' });
    wrap.appendChild(inputRow);
    wrap.appendChild(list);

    // click outside to close
    wrap.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });

    // close when clicking outside - added later at document level
    paletteEl = wrap;
    paletteInput = input;
    paletteList = list;

    // keyboard handling inside palette
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        movePalette(1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        movePalette(-1);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        closePalette();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        activatePaletteSelection();
      }
    });

    input.addEventListener('input', () => {
      refreshPaletteResults();
    });

    return wrap;
  }

  function openPalette() {
    if (!paletteEl) {
      // attempt to find in DOM
      paletteEl = firstMatch(panel, ['.cptbx-palette']);
      if (!paletteEl) {
        paletteEl = createPaletteElement();
        panel.appendChild(paletteEl);
      } else {
        paletteInput = paletteEl.querySelector('input');
        paletteList = paletteEl.querySelector('.cptbx-palette-list');
      }
    }
    paletteEl.style.display = 'flex';
    paletteEl.setAttribute('aria-hidden', 'false');
    paletteOpen = true;
    paletteActiveIndex = -1;
    paletteInput.value = '';
    refreshPaletteResults();
    setTimeout(() => paletteInput && paletteInput.focus(), 20);

    // closing on outside click
    document.addEventListener('click', docClickClosePalette);
    document.addEventListener('keydown', docKeyClosePalette);
  }

  function closePalette() {
    if (!paletteEl) return;
    paletteEl.style.display = 'none';
    paletteEl.setAttribute('aria-hidden', 'true');
    paletteOpen = false;
    paletteActiveIndex = -1;
    paletteResults = [];
    if (paletteList) paletteList.innerHTML = '';
    document.removeEventListener('click', docClickClosePalette);
    document.removeEventListener('keydown', docKeyClosePalette);
  }

  function togglePalette() {
    if (paletteOpen) closePalette();
    else openPalette();
  }

  function docClickClosePalette(ev) {
    if (!paletteEl) return;
    if (!paletteEl.contains(ev.target)) closePalette();
  }
  function docKeyClosePalette(ev) {
    if (ev.key === 'Escape') closePalette();
    // if user presses Ctrl/Cmd+K again while palette open, close it
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      closePalette();
    }
  }

  function buildPaletteCandidates() {
    // Two fixed commands + snippets
    const commands = [
      { id: '__add__', kind: 'command', title: 'Add snippet', hint: 'Create a new snippet' },
      { id: '__refresh__', kind: 'command', title: 'Refresh snippets', hint: 'Reload and merge packaged snippets' }
    ];
    const snippetsCandidates = (scripts || []).map((s) => ({
      id: s.id,
      kind: 'snippet',
      title: s.title || '(untitled)',
      hint: s.source ? 'bundled' : (s.localEdited ? 'local' : '')
    }));
    return commands.concat(snippetsCandidates);
  }

  function refreshPaletteResults() {
    if (!paletteEl || !paletteInput || !paletteList) return;
    const q = (paletteInput.value || '').trim().toLowerCase();
    const candidates = buildPaletteCandidates();
    const filtered = candidates.filter((c) => {
      if (!q) return true;
      return (c.title || '').toLowerCase().includes(q) || (c.hint || '').toLowerCase().includes(q);
    }).slice(0, 200);

    paletteResults = filtered;
    paletteActiveIndex = filtered.length ? 0 : -1;
    renderPaletteList();
  }

  function renderPaletteList() {
    if (!paletteList) return;
    paletteList.innerHTML = '';
    paletteResults.forEach((r, i) => {
      const item = create('div', { class: 'cptbx-palette-item' + (i === paletteActiveIndex ? ' is-active' : ''), 'data-index': String(i), 'role': 'button', tabindex: 0 });
      const label = create('div', { class: 'label' }, [r.title]);
      const muted = create('div', { class: 'muted' }, [r.hint || (r.kind === 'command' ? 'command' : '')]);
      item.appendChild(label);
      item.appendChild(muted);
      item.addEventListener('click', () => {
        paletteActiveIndex = i;
        activatePaletteSelection();
      });
      item.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') activatePaletteSelection();
      });
      paletteList.appendChild(item);
    });
  }

  function movePalette(delta) {
    if (!paletteResults || paletteResults.length === 0) return;
    paletteActiveIndex = Math.max(0, Math.min(paletteResults.length - 1, paletteActiveIndex + delta));
    // update active class
    const items = paletteList.querySelectorAll('.cptbx-palette-item');
    items.forEach((it, idx) => {
      it.classList.toggle('is-active', idx === paletteActiveIndex);
      if (idx === paletteActiveIndex) {
        // ensure visible
        it.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  async function activatePaletteSelection() {
    if (!paletteResults || paletteResults.length === 0 || paletteActiveIndex < 0) return;
    const sel = paletteResults[paletteActiveIndex];
    if (!sel) return;
    if (sel.kind === 'command') {
      if (sel.id === '__add__') {
        closePalette();
        onAddSnippet();
        return;
      }
      if (sel.id === '__refresh__') {
        closePalette();
        await onRefreshSnippets();
        return;
      }
    } else if (sel.kind === 'snippet') {
      // copy snippet code
      const s = scripts.find((x) => x.id === sel.id);
      if (s) {
        const ok = await setClipboard(s.code || '');
        showToast(ok ? 'Copied snippet' : 'Copy failed');
        closePalette();
        return;
      }
    }
    closePalette();
  }

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

  // ensure palette element reference if bundled HTML added it
  paletteEl = firstMatch(panel, ['.cptbx-palette']);
  if (paletteEl) {
    paletteInput = paletteEl.querySelector('input');
    paletteList = paletteEl.querySelector('.cptbx-palette-list');
  }

  // if user focuses the panel search and wants quick palette hint, optional: show hint (not shown by default)

  console.log('[CPToolbox] Ready - assets loaded locally. Toggle with Ctrl+RightClick. Command palette: Ctrl/Cmd+K');
})();
