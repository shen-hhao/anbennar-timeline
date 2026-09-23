/** Keep the atlas and its existing timeline together in both fullscreen modes. */
export function initializeMapFullscreen({document: doc = globalThis.document} = {}) {
  const body = doc.body, target = doc.documentElement;
  const enter = doc.getElementById('map-fullscreen');
  const leave = doc.getElementById('map-fullscreen-exit');
  const native = doc.getElementById('map-native-fullscreen');
  const controls = doc.getElementById('map-fullscreen-controls');
  const status = doc.getElementById('map-fullscreen-status');
  const map = doc.getElementById('map');
  const win = doc.defaultView;
  let active = false, ownsNative = false, pending = false, destroyed = false;
  let generation = 0, pendingGeneration = null, nativeGeneration = null, previousFocus = null, previousScroll = null;
  const listeners = [];
  function listen(element, name, callback, options) {
    element.addEventListener(name, callback, options);
    listeners.push(() => element.removeEventListener(name, callback, options));
  }
  function render() {
    body.classList.toggle('map-fullscreen', active);
    body.dataset.mapFullscreen = active ? (ownsNative ? 'screen' : 'page') : 'off';
    enter.setAttribute('aria-pressed', String(active));
    controls.hidden = !active;
    native.hidden = ownsNative;
    native.disabled = pending || typeof target.requestFullscreen !== 'function' || doc.fullscreenEnabled === false;
    native.setAttribute('aria-busy', String(pending));
    native.title = native.disabled && !pending ? '当前浏览器支持网页全屏；可用 Esc 或退出按钮返回' : '隐藏浏览器界面，使用整个屏幕';
  }
  function setActive(next, {restoreFocus = true} = {}) {
    if (active === next) { render(); return; }
    if (next) {
      previousFocus = doc.activeElement;
      previousScroll = {left: win?.scrollX || 0, top: win?.scrollY || 0};
    }
    active = next;
    if (!next) generation++;
    render();
    if (next) map.focus({preventScroll: true});
    else if (restoreFocus) {
      (previousFocus?.isConnected ? previousFocus : enter).focus({preventScroll: true});
      if (previousScroll) win?.scrollTo?.(previousScroll);
    }
  }
  function enterPage() {
    if (destroyed) return;
    status.textContent = '';
    setActive(true);
  }
  async function exit() {
    if (destroyed) return false;
    setActive(false);
    if (doc.fullscreenElement === target && ownsNative) {
      try { await doc.exitFullscreen(); }
      catch {
        if (!destroyed && doc.fullscreenElement === target) {
          nativeGeneration = generation;
          setActive(true);
          status.textContent = '请按 Esc 退出电脑全屏。';
        }
        return false;
      }
    }
    return true;
  }
  async function enterNative() {
    if (destroyed || pending || ownsNative) return false;
    enterPage();
    if (typeof target.requestFullscreen !== 'function' || doc.fullscreenEnabled === false) {
      status.textContent = '当前浏览器不支持电脑全屏，已使用网页全屏。';
      return false;
    }
    const requestGeneration = generation;
    pendingGeneration = requestGeneration;
    pending = true;
    render();
    try {
      // This call stays in the explicit button gesture, before the first await.
      await target.requestFullscreen();
      if (destroyed || !active || generation !== requestGeneration) {
        if (doc.fullscreenElement === target) {
          try { await doc.exitFullscreen(); } catch { /* Browser Esc remains available. */ }
        }
        return false;
      }
      ownsNative = doc.fullscreenElement === target;
      if (ownsNative) nativeGeneration = requestGeneration;
      return ownsNative;
    } catch {
      if (!destroyed && active) status.textContent = '电脑全屏未开启，继续使用网页全屏。';
      return false;
    } finally {
      pending = false;
      pendingGeneration = null;
      if (!destroyed) render();
    }
  }
  function onFullscreenChange() {
    if (doc.fullscreenElement === target) {
      // Ignore fullscreen requests made by another feature or browser extension.
      if (active && pending && pendingGeneration === generation) {
        ownsNative = true;
        nativeGeneration = pendingGeneration;
      }
    } else if (ownsNative) {
      const exitedGeneration = nativeGeneration;
      ownsNative = false;
      nativeGeneration = null;
      // A delayed exit belongs to the previous native session. It must not
      // dismiss a webpage fullscreen session opened while that exit was pending.
      if (exitedGeneration === generation) setActive(false);
    }
    render();
  }
  function onKeydown(event) {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    // The canvas also uses Escape to clear selection. Keep that selection intact.
    event.stopImmediatePropagation();
    void exit();
  }
  listen(enter, 'click', enterPage);
  listen(leave, 'click', () => { void exit(); });
  listen(native, 'click', () => { void enterNative(); });
  listen(doc, 'keydown', onKeydown, true);
  listen(doc, 'fullscreenchange', onFullscreenChange);
  render();
  return {
    enterPage, enterNative, exit,
    get active() { return active; },
    get native() { return ownsNative; },
    destroy() {
      if (destroyed) return;
      setActive(false, {restoreFocus: false});
      destroyed = true;
      for (const remove of listeners) remove();
      if (doc.fullscreenElement === target && ownsNative) {
        try { Promise.resolve(doc.exitFullscreen()).catch(() => {}); } catch { /* Optional API. */ }
      }
      ownsNative = false;
      nativeGeneration = null;
    },
  };
}
