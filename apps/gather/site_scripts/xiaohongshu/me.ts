async function(args) {
  const loginModal = document.querySelector('.login-modal, [class*="login-container"], .login-btn');
  if (loginModal) return { ok: false, error: 'Login modal is visible', hint: 'Please log in to xiaohongshu first.' };

  const userSidebar = document.querySelector('li.user.side-bar-component');
  const profileLink = userSidebar?.querySelector('a[href*="/user/profile/"]') || document.querySelector('a[href*="/user/profile/"]');
  if (!userSidebar && !profileLink) return { ok: false, error: 'Missing user sidebar/profile link', hint: 'Session may be expired.' };

  return { ok: true };
}
