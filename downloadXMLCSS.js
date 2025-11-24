/**
 * DownloadXMLCSS.js
 *
 * Library-style script intended to be loaded dynamically (for example,
 * injected by a userscript). It does NOT auto-run. Call `downloadxmlcss(options)`
 * to run.
 *
 * Example usage after injection:
 *   window.downloadxmlcss(); // auto-detect & download CSS/XML found on page
 *   window.downloadxmlcss({ urls: ['https://example.com/style.css'] });
 *
 * Attaches function to window.CPToolkit.downloadxmlcss as well.
 *
 * Author: prepared for CivicPlus toolkit
 * Date:   2025-11
 */

/* eslint-disable no-console */
(function () {
  'use strict';

  // Safe namespace: attach to CPToolkit
  window.CPToolkit = window.CPToolkit || {};

  /**
   * Helper: download given text content as a file with the given filename.
   * Returns a Promise that resolves after the download is triggered.
   */
  function downloadTextAsFile(filename, text, mime = 'text/plain;charset=utf-8') {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([text], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        // Append to DOM to ensure click works in some browsers
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve({ ok: true, filename });
      } catch (err) {
        console.error('[DownloadXMLCSS] downloadTextAsFile failed', err);
        resolve({ ok: false, filename, err });
      }
    });
  }

  /**
   * Helper: fetch a URL and return object { ok, url, status, text, err }
   */
  async function fetchText(url, timeoutMs = 10000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    try {
      if (controller && timeoutMs) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }
      const resp = await fetch(url, { signal: controller ? controller.signal : undefined, credentials: 'same-origin' });
      const status = resp.status;
      if (!resp.ok) {
        return { ok: false, url, status, text: null, err: new Error('HTTP ' + status) };
      }
      const text = await resp.text();
      return { ok: true, url, status, text };
    } catch (err) {
      return { ok: false, url, status: null, text: null, err };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Heuristic: canonicalize a URL found in the DOM to an absolute URL.
   * If the url is already absolute, return as-is; otherwise resolve relative to document.baseURI.
   */
  function toAbsoluteUrl(href) {
    try {
      return new URL(href, document.baseURI).href;
    } catch (e) {
      return href;
    }
  }

  /**
   * Auto-detection of CSS and XML links on the page.
   * Returns { css: [url], xml: [url] }
   */
  function detectCssAndXmlUrls() {
    const cssUrls = new Set();
    const xmlUrls = new Set();

    // 1) <link rel="stylesheet" href="...">
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((lnk) => {
      const href = lnk.getAttribute('href');
      if (!href) return;
      const abs = toAbsoluteUrl(href);
      if (abs.toLowerCase().endsWith('.css') || /\/assets\//i.test(abs)) cssUrls.add(abs);
    });

    // 2) <link href="..." maybe type etc. other link tags (some themes embed CSS with other rels)
    document.querySelectorAll('link[href]').forEach((lnk) => {
      const href = lnk.getAttribute('href');
      if (!href) return;
      const abs = toAbsoluteUrl(href);
      if (abs.toLowerCase().endsWith('.css')) cssUrls.add(abs);
      if (abs.toLowerCase().endsWith('.xml')) xmlUrls.add(abs);
    });

    // 3) <a href="..."> pointing to .xml
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      const abs = toAbsoluteUrl(href);
      if (abs.toLowerCase().endsWith('.xml')) xmlUrls.add(abs);
    });

    // 4) scripts or other tags referencing XML endpoints (common patterns)
    // Look for data attributes or inline hints: data-xml-src etc.
    document.querySelectorAll('[data-xml-src], [data-src], script[type="application/xml"]').forEach((el) => {
      const src = el.getAttribute('data-xml-src') || el.getAttribute('data-src') || el.getAttribute('src') || el.textContent;
      if (!src) return;
      const abs = toAbsoluteUrl(src.trim());
      if (abs.toLowerCase().endsWith('.xml')) xmlUrls.add(abs);
    });

    // 5) Common CivicPlus known endpoints (heuristic): try a few well-known patterns relative to site root
    // These are guesses — we only add them as candidates (not guaranteed)
    const hostRoot = location.origin;
    const candidates = [
      '/assets/mystique/shared/components/moduletiles/templates/cp-Module-Tile.html',
      '/Assets/Mystique/Shared/Components/ModuleTiles/Templates/cp-Module-Tile.html',
      '/Services/Content/GetXml', // hypothetical
      '/Config/SiteConfig.xml'
    ];
    candidates.forEach(c => {
      const abs = toAbsoluteUrl(c);
      // add as XML candidate if ends with .xml or contains 'xml' or 'Template' etc.
      if (/\.xml$/i.test(abs) || /template/i.test(abs) || /Service/i.test(abs)) {
        xmlUrls.add(abs);
      }
    });

    return {
      css: Array.from(cssUrls),
      xml: Array.from(xmlUrls)
    };
  }

  /**
   * Normalize filename from a URL. If the URL ends with a path, returns last segment; otherwise a sanitized fallback name.
   */
  function filenameFromUrl(url, fallbackPrefix = 'download') {
    try {
      const u = new URL(url);
      const pathname = u.pathname;
      const last = pathname.substring(pathname.lastIndexOf('/') + 1) || '';
      if (last) return decodeURIComponent(last.split('?')[0]) || fallbackPrefix;
      // otherwise use host + timestamp
      return (u.hostname || 'file') + '-' + Date.now();
    } catch (err) {
      // fallback: sanitize url
      const sanitized = url.replace(/[^a-z0-9\-_\.]/gi, '-').slice(0, 80);
      return sanitized || (fallbackPrefix + '-' + Date.now());
    }
  }

  /**
   * Main exported function.
   *
   * options:
   *  - urls: Array<string> (explicit list to download). If provided, detection is skipped.
   *  - types: Array<'css'|'xml'> (restrict auto-detection to types)
   *  - autoConfirm: boolean (if true won't prompt before downloading multiple files)
   *  - timeoutMs: number (fetch timeout per file)
   *
   * Returns a Promise that resolves to an object { results: [ { url, ok, filename, err } ], summary: {...} }
   */
  async function downloadxmlcss(options = {}) {
    const cfg = Object.assign(
      {
        urls: null,
        types: ['css', 'xml'],
        autoConfirm: false,
        timeoutMs: 15000
      },
      options || {}
    );

    console.log('[DownloadXMLCSS] starting with options:', cfg);

    // 1) Determine target URLs
    let targets = [];

    if (Array.isArray(cfg.urls) && cfg.urls.length > 0) {
      targets = cfg.urls.map(toAbsoluteUrl);
    } else {
      // detect
      const detected = detectCssAndXmlUrls();
      if (cfg.types.includes('css') && Array.isArray(detected.css)) targets.push(...detected.css);
      if (cfg.types.includes('xml') && Array.isArray(detected.xml)) targets.push(...detected.xml);
      // dedupe
      targets = Array.from(new Set(targets));
    }

    if (targets.length === 0) {
      console.warn('[DownloadXMLCSS] no candidate URLs found to download.');
      return { results: [], summary: { message: 'no-candidates' } };
    }

    // If many files and autoConfirm is false, ask user to confirm (prompt)
    if (!cfg.autoConfirm && targets.length > 1) {
      // use confirm in page context — loader can choose to set autoConfirm true to bypass
      const ok = confirm(`[DownloadXMLCSS] Found ${targets.length} files to download. Proceed?`);
      if (!ok) {
        console.log('[DownloadXMLCSS] user cancelled downloads.');
        return { results: [], summary: { message: 'user-cancelled' } };
      }
    }

    const results = [];
    for (const t of targets) {
      try {
        console.log('[DownloadXMLCSS] fetching', t);
        const r = await fetchText(t, cfg.timeoutMs);
        if (!r.ok) {
          console.warn('[DownloadXMLCSS] fetch failed for', t, r.err || r.status);
          results.push({ url: t, ok: false, status: r.status, err: r.err || new Error('fetch-failed') });
          continue;
        }
        // choose mime type by extension
        const lower = t.toLowerCase();
        let mime = 'text/plain;charset=utf-8';
        if (lower.endsWith('.css')) mime = 'text/css;charset=utf-8';
        else if (lower.endsWith('.xml')) mime = 'application/xml;charset=utf-8';
        else if (lower.endsWith('.html') || lower.endsWith('.htm')) mime = 'text/html;charset=utf-8';

        const filename = filenameFromUrl(t);
        const dl = await downloadTextAsFile(filename, r.text, mime);
        results.push(Object.assign({ url: t, ok: dl.ok !== false, filename }, dl));
      } catch (err) {
        console.error('[DownloadXMLCSS] error processing', t, err);
        results.push({ url: t, ok: false, err });
      }
    }

    const okCount = results.filter((x) => x.ok).length;
    const failCount = results.length - okCount;
    console.log(`[DownloadXMLCSS] finished: ${okCount} succeeded, ${failCount} failed`);

    return {
      results,
      summary: {
        total: results.length,
        succeeded: okCount,
        failed: failCount
      }
    };
  }

  // expose on window and CPToolkit for convenience
  window.downloadxmlcss = downloadxmlcss;
  window.CPToolkit = window.CPToolkit || {};
  window.CPToolkit.downloadxmlcss = downloadxmlcss;

  // Also export a small helper to detect candidate urls (useful for UI)
  window.CPToolkit.detectCssAndXmlUrls = detectCssAndXmlUrls;

  // End of module
})();
