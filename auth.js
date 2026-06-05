// ── Auth state ───────────────────────────────────────────────
// Shared global — script.js reads currentUser for DB queries.
let currentUser = null;

// ── Loading overlay ──────────────────────────────────────────
function showLoading() {
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ── Auth screen helpers ──────────────────────────────────────
function showAuthScreen() {
  document.getElementById('loading-overlay').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('schedule-screen').classList.add('hidden');
  clearAuthMessages();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  document.getElementById('auth-success').classList.add('hidden');
}

function showAuthSuccess(msg) {
  const el = document.getElementById('auth-success');
  el.textContent = msg;
  el.classList.remove('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

function clearAuthMessages() {
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('auth-success').classList.add('hidden');
}

// ── Auth actions ─────────────────────────────────────────────
async function signIn() {
  const email    = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  if (!email || !password) { showAuthError('Please enter your email and password.'); return; }

  const btn = document.getElementById('signin-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (error) showAuthError(error.message);
  // Success is handled by onAuthStateChange → initHomeScreen()
}

async function signUp() {
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!email || !password) { showAuthError('Please enter your email and password.'); return; }
  if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }

  const btn = document.getElementById('signup-btn');
  btn.disabled = true; btn.textContent = 'Creating account…';

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  btn.disabled = false; btn.textContent = 'Create account';

  if (error) { showAuthError(error.message); return; }

  if (!data.session) {
    // Email confirmation required (default Supabase setting)
    showAuthSuccess('Account created! Check your email to confirm, then sign in.');
  }
  // If email confirmation is disabled, onAuthStateChange handles the transition
}

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) showAuthError(error.message);
}

async function signOut() {
  await supabaseClient.auth.signOut();
  // onAuthStateChange → SIGNED_OUT handles the rest
}

// ── Auth wiring ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Tab switching
  document.getElementById('tab-signin').addEventListener('click', () => {
    document.getElementById('tab-signin').classList.add('active');
    document.getElementById('tab-signup').classList.remove('active');
    document.getElementById('auth-pane-signin').classList.remove('hidden');
    document.getElementById('auth-pane-signup').classList.add('hidden');
    clearAuthMessages();
  });
  document.getElementById('tab-signup').addEventListener('click', () => {
    document.getElementById('tab-signup').classList.add('active');
    document.getElementById('tab-signin').classList.remove('active');
    document.getElementById('auth-pane-signup').classList.remove('hidden');
    document.getElementById('auth-pane-signin').classList.add('hidden');
    clearAuthMessages();
  });

  // Sign-in / Sign-up form buttons
  document.getElementById('signin-btn').addEventListener('click', signIn);
  document.getElementById('signup-btn').addEventListener('click', signUp);
  document.getElementById('google-btn').addEventListener('click', signInWithGoogle);
  document.getElementById('signin-password').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
  document.getElementById('signup-password').addEventListener('keydown', e => { if (e.key === 'Enter') signUp(); });

  // Logout buttons (home topbar + schedule topbar)
  document.getElementById('logout-btn').addEventListener('click', signOut);
  document.getElementById('schedule-logout-btn').addEventListener('click', signOut);

  // ── Initial session check ────────────────────────────────
  // Runs once on page load. If a session already exists (returning user or
  // OAuth redirect), skip the auth screen and go straight to home.
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    currentUser = session?.user ?? null;
    if (currentUser) {
      initHomeScreen(); // defined in script.js, available by the time this resolves
    } else {
      showAuthScreen();
    }
  });

  // ── Auth state changes ───────────────────────────────────
  // Handles: Google OAuth redirect, sign-in, sign-out, token refresh.
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !currentUser) {
      currentUser = session.user;
      initHomeScreen();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      events = []; // reset app state; `events` declared in script.js
      showAuthScreen();
    }
  });
});
