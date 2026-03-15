async function(args) {
  const loginBtn = document.querySelector('button:has-text("登录"), [class*="login-btn"], a:has-text("登录")');
  if (loginBtn) return { ok: false, error: 'Login button is visible', hint: 'Please log in to douyin first.' };

  const hasUser = Boolean(document.querySelector('.avatar-wrapper, [class*="avatar"], .user-avatar, a[href*="/user/"]'));
  if (!hasUser) return { ok: false, error: 'Missing user avatar/profile link', hint: 'Session may be expired.' };

  return { ok: true };
}
