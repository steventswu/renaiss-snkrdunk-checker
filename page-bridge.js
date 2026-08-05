// Runs in the same JavaScript context as the Renaiss app. It has no extension
// privileges; it only reports client-side URL changes to the content script.
(() => {
  if (window.__renaissIndexRouteBridgeInstalled) return;
  window.__renaissIndexRouteBridgeInstalled = true;

  const reportRoute = () => {
    window.dispatchEvent(new CustomEvent('renaiss-index-route-change', {
      detail: { url: location.href }
    }));
  };

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(reportRoute);
      return result;
    };
  }

  window.addEventListener('popstate', reportRoute);
  window.addEventListener('hashchange', reportRoute);
})();
