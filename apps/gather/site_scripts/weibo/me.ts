async function(args) {
  const loginBtn = document.querySelector('a[href*="login"], .gn_login, button:has-text("登录"), .LoginCard');
  if (loginBtn) return { ok: false, error: 'Login button/card is visible', hint: 'Please log in to weibo first.' };

  const hasUser = Boolean(document.querySelector('.gn_name, .nav_avatar, a[href*="/u/"], .woo-avatar-main, .Nav_user_'));
  if (!hasUser) return { ok: false, error: 'Missing user nav/avatar element', hint: 'Session may be expired.' };

  return { ok: true };
}
