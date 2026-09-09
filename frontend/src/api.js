/**
 * One place for HTTP.
 *
 * Two behaviours worth naming:
 *  - The role is never trusted from localStorage. `fetchIdentity` asks the
 *    server who we are, because the server is the only thing that decides.
 *  - A 401 clears the session once, centrally, instead of every screen
 *    inventing its own recovery.
 */
import axios from 'axios';

const defaultBaseUrl = import.meta.env.PROD
  ? 'https://akki445-archivemind-backend.hf.space'
  : 'http://127.0.0.1:8000';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultBaseUrl,
  timeout: 120000,
});


let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearSession();
      if (onUnauthorized) onUnauthorized();
    }
    return Promise.reject(error);
  },
);

/** Turn any axios failure into a sentence worth showing someone. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (error?.code === 'ECONNABORTED') return 'That took too long. Please try again.';
  if (!error?.response) return 'Cannot reach the server. Check that the backend is running.';
  return fallback;
}

export function saveSession({ access_token, username, role }) {
  localStorage.setItem('token', access_token);
  localStorage.setItem('username', username);
  localStorage.setItem('role', role);
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('role');
}

export function storedSession() {
  return {
    token: localStorage.getItem('token'),
    username: localStorage.getItem('username'),
    role: localStorage.getItem('role') || 'user',
  };
}

// --- Auth --------------------------------------------------------------------
export const login = (username, password) =>
  api.post('/api/auth/login', { username, password }).then((r) => r.data);

/**
 * `details` carries the profile fields and, for a government official, the
 * access code. The server decides the role from them - the client is asking,
 * not granting. See backend/auth.py.
 */
export const register = (username, password, details = {}) =>
  api.post('/api/auth/register', { username, password, ...details }).then((r) => r.data);

/** Server-authoritative identity, plus the profile. Called on every boot. */
export const fetchIdentity = () => api.get('/api/auth/me', { timeout: 10000 }).then((r) => r.data);

export const updateProfile = (profile) => api.put('/api/auth/me', profile).then((r) => r.data);

export const updatePassword = (payload) =>
  api.put('/api/auth/me/password', payload).then((r) => r.data);

export const fetchUsers = () => api.get('/api/auth/users').then((r) => r.data.users);

export const updateUserRole = (username, role) =>
  api.put(`/api/auth/users/${encodeURIComponent(username)}/role`, { role }).then((r) => r.data);

// --- Documents ---------------------------------------------------------------
export const fetchDocuments = () =>
  api.get('/api/documents', { params: { t: Date.now() } }).then((r) => r.data.documents);

export const deleteDocument = (docId) =>
  api.delete(`/api/documents/${docId}`).then((r) => r.data);

export const uploadDocument = (file, onProgress) => {
  const form = new FormData();
  form.append('file', file);
  return api
    .post('/api/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded * 100) / event.total));
        }
      },
    })
    .then((r) => r.data);
};

export const compareDocuments = (docIds, focus) =>
  api.post('/api/documents/compare', { doc_ids: docIds, focus }).then((r) => r.data);

// --- Chat --------------------------------------------------------------------
export const fetchSessions = () => api.get('/api/chat/sessions').then((r) => r.data.sessions);

export const createSession = (title, docId) =>
  api.post('/api/chat/sessions', { title, doc_id: docId }).then((r) => r.data);

export const renameSession = (id, title) =>
  api.put(`/api/chat/sessions/${id}`, { title }).then((r) => r.data);

export const setSessionDocument = (id, docId) =>
  api.put(`/api/chat/sessions/${id}/document`, { doc_id: docId }).then((r) => r.data);

export const deleteSession = (id) => api.delete(`/api/chat/sessions/${id}`).then((r) => r.data);

export const fetchHistory = (id) =>
  api.get(`/api/chat/history/${id}`).then((r) => r.data.messages);

export const sendMessage = (message, sessionId) =>
  api.post('/api/chat', { message, session_id: sessionId }).then((r) => r.data);

/**
 * The same answer as `sendMessage`, delivered as it is written.
 *
 * Uses `fetch` rather than the axios instance because axios buffers the whole
 * response before resolving, which is precisely what this avoids. That means
 * re-implementing the two things the axios interceptors do - attach the token,
 * and clear the session once on a 401 - so both are done explicitly below.
 *
 * `handlers` may provide onStatus(stage), onCitations(list), onToken(text) and
 * onDone(payload). Resolves to the final payload, which has the same shape
 * `sendMessage` resolves to, so a caller can fall back to it on failure.
 */
export async function streamMessage(message, sessionId, handlers = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${api.defaults.baseURL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  if (response.status === 401) {
    clearSession();
    if (onUnauthorized) onUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }

  if (!response.ok || !response.body) {
    let detail = 'That answer could not be generated.';
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // A non-JSON error body is not worth a second failure.
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final = null;
  let streamError = null;

  const handle = (event) => {
    switch (event.type) {
      case 'status':
        handlers.onStatus?.(event.stage);
        break;
      case 'citations':
        handlers.onCitations?.(event.citations || []);
        break;
      case 'token':
        handlers.onToken?.(event.text || '');
        break;
      case 'done':
        final = event;
        handlers.onDone?.(event);
        break;
      case 'error':
        streamError = event.detail || 'That answer could not be generated.';
        break;
      default:
        break;
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // A frame ends at a blank line. Whatever arrived mid-frame stays in the
    // buffer and is carried into the next read rather than parsed early.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        handle(JSON.parse(line.slice(5).trim()));
      } catch {
        // A malformed frame should not abort a stream that is otherwise fine.
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!final) throw new Error('The answer ended unexpectedly. Please try again.');
  return final;
}

/**
 * Rewrite a question already asked and regenerate from that point.
 * The server drops that message and everything after it before re-answering,
 * so the transcript never shows a reply to a question that was never asked.
 */
export const editMessage = (messageId, message, sessionId) =>
  api
    .post('/api/chat/edit', { message, session_id: sessionId, message_id: messageId })
    .then((r) => r.data);

export const fetchRecommendations = () =>
  api.get('/api/chat/recommendations').then((r) => r.data.recommendations);

// --- Graph -------------------------------------------------------------------
export const highlightGraph = (query, docId, refresh = false) =>
  api.post('/api/graph/highlight', { query, doc_id: docId, refresh }).then((r) => r.data);

export const fetchDocumentGraph = (docId, limit = 60) =>
  api.get(`/api/graph/document/${docId}`, { params: { limit } }).then((r) => r.data);

export const expandEntity = (entityKey, docId) =>
  api
    .get(`/api/graph/entity/${encodeURIComponent(entityKey)}/expand`, {
      params: { doc_id: docId },
    })
    .then((r) => r.data);

export const fetchProvenance = (source, target, docId) =>
  api
    .get('/api/graph/provenance', { params: { source, target, doc_id: docId } })
    .then((r) => r.data);

// --- Stats, health, analytics ------------------------------------------------
export const fetchStats = () => api.get('/api/stats').then((r) => r.data);

export const fetchHealth = () => api.get('/health/db').then((r) => r.data);

export const fetchUnanswered = (limit = 20) =>
  api.get('/api/analytics/unanswered', { params: { limit } }).then((r) => r.data.questions);

export const fetchAnalytics = () => api.get('/api/analytics/overview').then((r) => r.data);

/** What the archive covers well, and what people are asking it to cover next. */
export const fetchCoverage = () => api.get('/api/analytics/coverage').then((r) => r.data);

export default api;
