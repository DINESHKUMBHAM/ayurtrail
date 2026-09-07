/* ==========================================================================
   Login, logout, the authenticated/unauthenticated screen swap, role-based
   nav gating and the GCP inactivity timeout.
   ========================================================================== */

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll'];

// Nav entries hidden per role. Anything not listed stays visible.
const HIDDEN_NAV_BY_ROLE = {
  AUDITOR: ['nav-patients', 'nav-ecrf'],
  CRC: ['nav-audit']
};

const ALL_NAV_IDS = ['nav-dashboard', 'nav-patients', 'nav-ecrf', 'nav-pharmacovigilance', 'nav-audit'];

let inactivityTimer;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (!getToken()) return;

  inactivityTimer = setTimeout(() => {
    alert('Session expired due to 15 minutes of inactivity. Logging out for security compliance.');
    logout();
  }, INACTIVITY_LIMIT_MS);
}

function showLoginError(message) {
  const box = document.getElementById('loginError');
  if (!box) return;
  box.textContent = message;
  box.classList.add('visible');
}

function clearLoginError() {
  const box = document.getElementById('loginError');
  if (!box) return;
  box.textContent = '';
  box.classList.remove('visible');
}

async function loginAs(email, passwordInputId, role) {
  const passwordInput = document.getElementById(passwordInputId);
  const password = passwordInput ? passwordInput.value : '';
  clearLoginError();

  try {
    const res = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, role })
    });

    if (!res.ok) {
      showLoginError(await readError(res, 'Login failed.'));
      return;
    }

    const data = await res.json();
    saveSession(data.token, data.user);
    resetInactivityTimer();
    renderScreenState();
  } catch (err) {
    showLoginError(`Cannot reach the server: ${err.message}`);
  }
}

function logout() {
  clearTimeout(inactivityTimer);
  clearSession();
  renderScreenState();
}

function renderScreenState() {
  const loginWrapper = document.getElementById('login-wrapper');
  const appContainer = document.getElementById('appContainer');
  const isAuthenticated = Boolean(getToken() && getCurrentUser());

  if (isAuthenticated) {
    if (loginWrapper) loginWrapper.style.display = 'none';
    if (appContainer) appContainer.classList.add('authenticated');
    updateUIUser();
    navigate('dashboard');
  } else {
    if (loginWrapper) loginWrapper.style.display = 'flex';
    if (appContainer) appContainer.classList.remove('authenticated');
  }
}

function updateUIUser() {
  const box = document.getElementById('userInfo');
  if (!box) return;

  const user = getCurrentUser();
  if (!user) {
    box.innerHTML = '<em>Not Authenticated</em>';
    return;
  }

  box.innerHTML = `<strong>${user.name}</strong><br>Role: <span class="role-tag">${user.role}</span>`;
  applyRolePermissions(user.role);
}

function applyRolePermissions(role) {
  const hidden = HIDDEN_NAV_BY_ROLE[role] || [];

  ALL_NAV_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hidden.includes(id) ? 'none' : 'block';
  });
}

function bindSession() {
  ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetInactivityTimer));

  // Fired by apiFetch when the API rejects our token.
  window.addEventListener('ctms:session-expired', () => {
    if (!getToken()) return;
    clearSession();
    renderScreenState();
    showLoginError('Your session expired. Please sign in again.');
  });

  resetInactivityTimer();
}
