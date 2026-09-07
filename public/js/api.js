/* ==========================================================================
   Session storage access and the authenticated fetch wrapper.
   Every other module talks to the API through apiFetch.
   ========================================================================== */

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const SESSION_EXPIRED_EVENT = 'ctms:session-expired';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function notifySessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

// Returns the raw Response so callers decide how to handle non-2xx.
// Throws only on a genuine network failure.
async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    notifySessionExpired();
  } else if (response.status === 403) {
    // The API returns 403 for two different things: an expired/invalid token
    // and a role that is simply not permitted. Only the first should end the
    // session, so the message decides.
    try {
      const body = await response.clone().json();
      if (body && /session expired|invalid token/i.test(body.error || '')) {
        notifySessionExpired();
      }
    } catch (e) {
      /* non-JSON body: treat as a plain authorization failure */
    }
  }

  return response;
}

// Reads an error message out of a failed response without throwing.
async function readError(response, fallback = 'Unknown error') {
  try {
    const data = await response.json();
    return (data && data.error) || fallback;
  } catch (e) {
    return `${fallback} (HTTP ${response.status})`;
  }
}
