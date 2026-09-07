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

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000',
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

export const register = (username, password) =>
  api.post('/api/auth/register', { username, password }).then((r) => r.data);

/** Server-authoritative identity. Called on every boot. */
export const fetchIdentity = () => api.get('/api/auth/me').then((r) => r.data);

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

export default api;
