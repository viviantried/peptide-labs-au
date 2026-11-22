(function () {
  const dialog = document.getElementById('popupOverlay');
  const dismissalKey = 'plTenVialOfferDismissedV1';
  const dismissalWindow = 7 * 86400000;
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

  // The offer remains available from explicit storefront links. It does not
  // interrupt shoppers automatically while they are browsing or checking out.
})();
