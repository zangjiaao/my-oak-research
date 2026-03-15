async function(args) {
  const hasChatList = Boolean(document.querySelector('#LeftColumn, .chat-list, [class*="ChatList"], .ListItem, #MiddleColumn, .messages-container'));
  if (hasChatList) return { ok: true };

  const qrView = Boolean(document.querySelector('.qr-container, [class*="QrCode"], .auth-form, canvas.qr'));
  if (qrView) return { ok: false, error: 'QR/login view detected', hint: 'Please log in to Telegram Web first.' };

  return { ok: false, error: 'Cannot confirm logged-in state', hint: 'Session may be expired.' };
}
