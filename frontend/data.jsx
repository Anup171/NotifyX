// NotifyX data layer — mock data for charts + real API client

// ─── Auth helpers ────────────────────────────────────────────────────────────
const API_BASE = (window.NOTIFYX_API_URL || 'http://localhost:3000').replace(/\/$/, '');

const getToken = () => localStorage.getItem('notifyx_token');
const setToken = (t) => localStorage.setItem('notifyx_token', t);
const getUserId = () => localStorage.getItem('notifyx_user_id');
const setUserId = (id) => localStorage.setItem('notifyx_user_id', id);
const clearAuth = () => {
  localStorage.removeItem('notifyx_token');
  localStorage.removeItem('notifyx_user_id');
};

const ensureToken = async () => {
  return getToken();
};

const apiFetch = async (path, opts = {}, retryCount = 0) => {
  let token = await ensureToken();
  let resp;
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
      throw new Error(`Server connection error. Please verify the API server is running on ${API_BASE}`);
    }
    throw err;
  }

  if (resp.status === 401 && retryCount < 1) {
    clearAuth();
    token = await ensureToken();
    return apiFetch(path, opts, retryCount + 1);
  }

  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    const err = new Error(payload.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
};

const login = async (userId, password) => {
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: { userId, password },
  });
  setToken(data.token);
  setUserId(userId);
  return data.token;
};

const signup = async (userId, password) => {
  const data = await apiFetch('/api/auth/signup', {
    method: 'POST',
    body: { userId, password },
  });
  setToken(data.token);
  setUserId(userId);
  return data.token;
};

const getIntegrations = async () => {
  return apiFetch('/api/users/integrations');
};

const toggleIntegration = async (provider, connected, accountName, credentials = {}) => {
  return apiFetch('/api/users/integrations/toggle', {
    method: 'POST',
    body: { provider, connected, accountName, ...credentials },
  });
};

const getMetricsSeries = async (range = '24h') => {
  return apiFetch(`/api/metrics/series?range=${range}`);
};

window.NTFX_AUTH = { getToken, setToken, getUserId, setUserId, clearAuth, login, signup, apiFetch, API_BASE, getIntegrations, toggleIntegration, getMetricsSeries };

const EMPTY_SERIES = {
  labels: ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'],
  sent: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  delivered: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  failed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const JOB_TYPES = [
  'email.transactional', 'email.digest', 'push.broadcast', 'push.silent',
  'sms.otp', 'inapp.mention', 'inapp.comment', 'webhook.outbound',
];
const STATUSES = ['active', 'pending', 'completed', 'failed', 'delayed'];

// Default preferences (used as loading state)
const DEFAULT_PREFS = {
  likes: { on: true, channels: { inapp: true, push: false, email: false } },
  comments: { on: true, channels: { inapp: true, push: true, email: false } },
  mentions: { on: true, channels: { inapp: true, push: true, email: true } },
  follows: { on: false, channels: { inapp: true, push: false, email: false } },
  digests: { on: true, channels: { inapp: false, push: false, email: true } },
  security: { on: true, channels: { inapp: true, push: true, email: true, sms: true } },
  marketing: { on: false, channels: { inapp: false, push: false, email: true } },
};

const PREF_DEFS = [
  { key: 'likes', icon: 'heart', label: 'Likes & reactions', desc: 'When someone reacts to a post or comment you authored.' },
  { key: 'comments', icon: 'comment', label: 'Comments & replies', desc: 'New comments on threads, docs, and tasks you participate in.' },
  { key: 'mentions', icon: 'at', label: 'Mentions', desc: 'Direct @-mentions in any channel or document.' },
  { key: 'follows', icon: 'user', label: 'New followers', desc: 'When someone follows your profile or runbooks.' },
  { key: 'digests', icon: 'mail', label: 'Weekly digest', desc: 'Sunday morning summary of activity you missed.' },
  { key: 'security', icon: 'shield', label: 'Security alerts', desc: 'Sign-ins, MFA changes, recovery codes. Cannot be disabled.', locked: true },
  { key: 'marketing', icon: 'tag', label: 'Product updates', desc: 'New features, changelog highlights, and beta invites.' },
];

window.NTFX_DATA = { EMPTY_SERIES, DEFAULT_PREFS, PREF_DEFS, JOB_TYPES, STATUSES };
