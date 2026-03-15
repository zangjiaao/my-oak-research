async function(args) {
  if (window.location.href.includes('login.php') || window.location.href.includes('/login/')) {
    return { ok: false, error: 'Redirected to login page', hint: 'Please log in to Facebook first.' };
  }

  const hasLoggedInUI = Boolean(document.querySelector('a[aria-label="Home"], div[aria-label="Account"], div[aria-label="Your profile"], input[placeholder*="Search Facebook"]'));
  if (!hasLoggedInUI) return { ok: false, error: 'Missing logged-in navigation elements', hint: 'Session may be expired.' };

  return { ok: true };
}
