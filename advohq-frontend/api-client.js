/**
 * AdvoHQ API Client
 * ─────────────────
 * Drop this script into every HTML page:
 *   <script src="/api-client.js"></script>
 *
 * It replaces all localStorage reads/writes with real API calls.
 * Handles token refresh transparently.
 *
 * Config:
 *   Set window.ADVOHQ_API_URL before loading this script, or set the
 *   data-api attribute on the <script> tag, or it defaults to /api.
 */

(function (global) {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────

  const API_URL = (global.ADVOHQ_API_URL || '').replace(/\/$/, '') || '/api';
  const TOKEN_KEY = 'advohq_access_token';

  // ── Token store ───────────────────────────────────────────────────────────

  const token = {
    get:   ()    => sessionStorage.getItem(TOKEN_KEY),
    set:   (t)   => sessionStorage.setItem(TOKEN_KEY, t),
    clear: ()    => sessionStorage.removeItem(TOKEN_KEY),
  };

  // ── Core fetch with auto-refresh ──────────────────────────────────────────

  let refreshPromise = null;

  async function apiFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const t = token.get();
    if (t) headers['Authorization'] = `Bearer ${t}`;

    const url = `${API_URL}${path}`;
    let res = await fetch(url, { ...options, headers, credentials: 'include' });

    // Token expired — try refresh once
    if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login') {
      if (!refreshPromise) {
        refreshPromise = fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error('Refresh failed')))
          .then(data => { token.set(data.data.accessToken); })
          .catch(() => {
            token.clear();
            // Redirect to login if refresh fails
            global.location.href = 'login.html';
          })
          .finally(() => { refreshPromise = null; });
      }

      await refreshPromise;

      // Retry original request with new token
      const newT = token.get();
      if (newT) headers['Authorization'] = `Bearer ${newT}`;
      res = await fetch(url, { ...options, headers, credentials: 'include' });
    }

    if (!res.ok && res.status !== 204) {
      let errBody;
      try { errBody = await res.json(); } catch { errBody = { error: res.statusText }; }
      throw Object.assign(new Error(errBody.error || 'API error'), { status: res.status, body: errBody });
    }

    if (res.status === 204) return null;
    const json = await res.json();
    return json.data ?? json;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const auth = {
    async register(username, email, fullName, password) {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, fullName, password }),
      });
      token.set(data.accessToken);
      return data.user;
    },

    async login(username, password) {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      token.set(data.accessToken);
      return data.user;
    },

    async logout() {
      await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
      token.clear();
      global.location.href = 'login.html';
    },

    async me() {
      return apiFetch('/auth/me');
    },

    isLoggedIn() {
      return !!token.get();
    },
  };

  // ── Cases ──────────────────────────────────────────────────────────────────

  const cases = {
    /** List all active cases */
    list(opts = {}) {
      const q = new URLSearchParams();
      if (opts.trashed)  q.set('trashed', 'true');
      if (opts.folderId) q.set('folder',  opts.folderId);
      if (opts.search)   q.set('search',  opts.search);
      if (opts.page)     q.set('page',    opts.page);
      if (opts.limit)    q.set('limit',   opts.limit);
      return apiFetch(`/cases?${q}`);
    },

    get(id)     { return apiFetch(`/cases/${id}`); },

    create(data) {
      return apiFetch('/cases', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    update(id, data) {
      return apiFetch(`/cases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    /** Move to trash (or hard-delete if already trashed) */
    delete(id) {
      return apiFetch(`/cases/${id}`, { method: 'DELETE' });
    },

    restore(id) {
      return apiFetch(`/cases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isTrash: false }),
      });
    },

    /** Get a signed download URL */
    downloadUrl(id) {
      return apiFetch(`/cases/${id}/download`);
    },

    /** List annotations on a case */
    annotations: {
      list(caseId) { return apiFetch(`/cases/${caseId}/annotations`); },
      add(caseId, data) {
        return apiFetch(`/cases/${caseId}/annotations`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
      },
    },
  };

  // ── Events / Schedule ─────────────────────────────────────────────────────

  const events = {
    list(opts = {}) {
      const q = new URLSearchParams();
      if (opts.from)   q.set('from',   opts.from);
      if (opts.to)     q.set('to',     opts.to);
      if (opts.type)   q.set('type',   opts.type);
      if (opts.caseId) q.set('caseId', opts.caseId);
      if (opts.page)   q.set('page',   opts.page);
      return apiFetch(`/events?${q}`);
    },

    get(id)     { return apiFetch(`/events/${id}`); },

    create(data) {
      return apiFetch('/events', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    update(id, data) {
      return apiFetch(`/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    delete(id) {
      return apiFetch(`/events/${id}`, { method: 'DELETE' });
    },
  };

  // ── File upload (S3 presigned) ────────────────────────────────────────────

  const files = {
    async upload(caseId, file, onProgress) {
      const { uploadUrl, s3Key } = await apiFetch('/files/presigned', {
        method: 'POST',
        body: JSON.stringify({
          caseId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
        }),
      });

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }
        xhr.onload  = () => (xhr.status < 300 ? resolve() : reject(new Error(`S3 upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
      });

      await cases.update(caseId, { s3Key, fileSize: file.size });
      return s3Key;
    },
  };

  // ── Folders ───────────────────────────────────────────────────────────────

  const folders = {
    list(parentId) {
      const q = new URLSearchParams();
      if (parentId) q.set('parent', parentId);
      return apiFetch(`/folders?${q}`);
    },

    get(id) { return apiFetch(`/folders/${id}`); },

    create(data) {
      return apiFetch('/folders', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    update(id, data) {
      return apiFetch(`/folders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    delete(id) {
      return apiFetch(`/folders/${id}`, { method: 'DELETE' });
    },
  };

  // ── Public API ────────────────────────────────────────────────────────────

  global.AdvoAPI = { auth, cases, events, files, folders, _fetch: apiFetch };

  // ── Auth guard (call on protected pages) ──────────────────────────────────

  global.requireAuth = function () {
    if (!auth.isLoggedIn()) {
      global.location.href = 'login.html?next=' + encodeURIComponent(global.location.pathname);
    }
  };

})(window);
