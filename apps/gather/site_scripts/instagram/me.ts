async function(args) {
  if (window.location.href.includes('/accounts/login')) {
    return { ok: false, error: 'Redirected to login page', hint: 'Please log in to Instagram first.' };
  }

  const hasLoggedInUI = Boolean(document.querySelector('svg[aria-label="Home"], svg[aria-label="New post"], svg[aria-label="Direct messaging"], img[alt*="profile picture"], a[href*="/direct/inbox/"]'));
  if (!hasLoggedInUI) return { ok: false, error: 'Missing logged-in navigation elements', hint: 'Session may be expired.' };

  return { ok: true };
}
