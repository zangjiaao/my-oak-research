async function(args) {
  const loginFlow = window.location.href.toLowerCase().includes('login') || window.location.href.toLowerCase().includes('/i/flow');
  if (loginFlow) return { ok: false, error: 'Redirected to login flow', hint: 'Please log in to x.com first.' };

  const hasNav = Boolean(document.querySelector('nav[role="navigation"]'));
  const hasProfile = Boolean(document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"], [aria-label*="Account"]'));
  if (!hasNav && !hasProfile) return { ok: false, error: 'Missing logged-in navigation elements', hint: 'Session may be expired.' };

  const handleText = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] span')?.textContent?.trim();
  return { ok: true, username: handleText || undefined };
}
