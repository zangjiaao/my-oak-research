async function(args) {
  const loginBtn = document.querySelector('button[data-e2e="top-login-button"], [class*="LoginButton"], button:has-text("Log in")');
  if (loginBtn) return { ok: false, error: 'Login button is visible', hint: 'Please log in to tiktok first.' };

  const hasProfile = Boolean(document.querySelector('[data-e2e="profile-icon"], a[href*="/@"], [class*="DivProfileContainer"], [class*="avatar"]'));
  if (!hasProfile) return { ok: false, error: 'Missing profile icon/link', hint: 'Session may be expired.' };

  return { ok: true };
}
