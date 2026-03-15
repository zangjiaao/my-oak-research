async function(args) {
  const loginBtn = document.querySelector('a[href*="login"], button[data-testid="login-button"], button:has-text("Log In")');
  if (loginBtn) return { ok: false, error: 'Login button is visible', hint: 'Please log in to reddit first.' };

  const hasUserMenu = Boolean(document.querySelector('#USER_DROPDOWN_ID, [data-testid="user-drawer-button"], a[href*="/user/"]'));
  if (!hasUserMenu) return { ok: false, error: 'Missing user menu', hint: 'Session may be expired.' };

  return { ok: true };
}
