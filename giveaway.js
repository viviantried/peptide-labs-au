(function () {
  const dialog = document.getElementById('popupOverlay');
  const form = document.getElementById('giveawayForm');
  const status = document.getElementById('giveawayStatus');
  const button = document.getElementById('giveawaySubmit');
  let saving = false;
  let automaticAttempted = false;
  let lastFocus;
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  };

  window.openPopup = function () {
    if (dialog.open) return;
    lastFocus = document.activeElement;
    dialog.showModal();
  };
  window.closePopup = function () { dialog.close(); };
  dialog.addEventListener('close', () => {
    storage.set('plGiveawayDismissedV2', String(Date.now()));
    lastFocus?.focus();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    saving = true;
    button.disabled = true;
    button.textContent = 'Saving your entry…';
    status.textContent = '';
    status.className = 'giveaway-status';
    try {
      const response = await fetch('/api/giveaway', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('popupEmail').value,
          entryConsent: true,
          marketingConsent: document.getElementById('giveawayMarketing').checked,
          website: document.getElementById('giveawayWebsite').value,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'We could not save your entry. Please try again.');
      storage.set('plGiveawayEnteredV2', '1');
      status.textContent = 'Your giveaway entry is saved. One entry per email address—submitting again won’t add another entry.';
      status.classList.add('giveaway-status--success');
      form.hidden = true;
      document.getElementById('giveawayDone').hidden = false;
      document.getElementById('giveawayDone').focus();
    } catch (error) {
      status.textContent = ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'Saving took too long. Please retry; using the same email will not create a duplicate entry.'
        : error.message;
      status.classList.add('giveaway-status--error');
    } finally {
      saving = false;
      button.disabled = false;
      button.textContent = 'Enter Monthly Giveaway';
    }
  });

  async function tryAutomaticPopup() {
    if (automaticAttempted || storage.get('plGiveawayEnteredV2')) return;
    const dismissedAt = Number(storage.get('plGiveawayDismissedV2')) || 0;
    if (Date.now() - dismissedAt < 7 * 86400000) return;
    if (document.body.classList.contains('research-agreement-pending')
        || document.getElementById('coOverlay')?.classList.contains('open')
        || !['page-home', 'page-shop', 'page-product'].includes(document.querySelector('.page.active')?.id)) return;
    automaticAttempted = true;
    try {
      const response = await fetch('/api/giveaway', { signal: AbortSignal.timeout(12000) });
      const result = await response.json();
      if (response.ok && result.available && !document.getElementById('coOverlay')?.classList.contains('open')
          && ['page-home', 'page-shop', 'page-product'].includes(document.querySelector('.page.active')?.id)) openPopup();
    } catch { /* Keep normal navigation available if the service cannot be reached. */ }
  }
  setTimeout(tryAutomaticPopup, 4500);
  document.addEventListener('click', () => setTimeout(tryAutomaticPopup, 4500));
})();
