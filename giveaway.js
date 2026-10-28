(function () {
  const dialog = document.getElementById('popupOverlay');
  const dismissalKey = 'plTenVialOfferDismissedV1';
  const dismissalWindow = 7 * 86400000;
  let automaticAttempted = false;
  let openBuilderAfterClose = false;
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
  window.openPromoBundleBuilder = function () {
    if (!dialog.open) {
      window.openMixBundleBuilder();
      return;
    }
    openBuilderAfterClose = true;
    dialog.close();
  };
  dialog.addEventListener('close', () => {
    storage.set(dismissalKey, String(Date.now()));
    if (openBuilderAfterClose) {
      openBuilderAfterClose = false;
      window.openMixBundleBuilder();
      return;
    }
    lastFocus?.focus();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  function tryAutomaticPopup() {
    if (automaticAttempted) return;
    const dismissedAt = Number(storage.get(dismissalKey)) || 0;
    if (Date.now() - dismissedAt < dismissalWindow) return;
    const activePageId = document.querySelector('.page.active')?.id;
    if (activePageId === 'page-home') return;
    if (document.body.classList.contains('research-agreement-pending')
        || document.getElementById('coOverlay')?.classList.contains('open')
        || !['page-shop', 'page-product'].includes(activePageId)) return;
    automaticAttempted = true;
    openPopup();
  }
  setTimeout(tryAutomaticPopup, 4500);
  document.addEventListener('click', () => setTimeout(tryAutomaticPopup, 4500));
})();
