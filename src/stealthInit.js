/**
 * Comprehensive browser stealth init script.
 * Patches navigator, WebGL, canvas, permissions, and Chrome runtime
 * to avoid bot/automation detection by reCAPTCHA and similar systems.
 */

export function getStealthScript() {
  return () => {
    // --- navigator.webdriver ---
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // --- navigator.plugins (realistic set) ---
    const fakePlugins = {
      length: 5,
      0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      3: { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      4: { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      item: (i) => fakePlugins[i] || null,
      namedItem: (n) => Object.values(fakePlugins).find((p) => p?.name === n) || null,
      refresh: () => {}
    };
    Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });

    // --- navigator.languages ---
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' });

    // --- navigator.permissions.query ---
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(parameters);
      };
    }

    // --- navigator.hardwareConcurrency ---
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // --- navigator.deviceMemory ---
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // --- navigator.maxTouchPoints ---
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

    // --- navigator.connection ---
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false
        })
      });
    }

    // --- chrome runtime mock ---
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
      id: undefined
    };
    window.chrome.loadTimes = () => ({
      commitLoadTime: Date.now() / 1000,
      connectionInfo: 'h2',
      finishDocumentLoadTime: Date.now() / 1000 + 0.5,
      finishLoadTime: Date.now() / 1000 + 1,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: Date.now() / 1000 + 0.1,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: Date.now() / 1000 - 0.5,
      startLoadTime: Date.now() / 1000 - 0.5,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true
    });
    window.chrome.csi = () => ({
      onloadT: Date.now(),
      startE: Date.now() - 500,
      pageT: 500
    });

    // --- WebGL fingerprint (realistic vendor/renderer) ---
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameterProto.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 37445) return 'Google Inc. (NVIDIA)';
        if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return getParameter2Proto.call(this, param);
      };
    }

    // --- Screen dimensions consistency ---
    Object.defineProperty(screen, 'availWidth', { get: () => screen.width });
    Object.defineProperty(screen, 'availHeight', { get: () => screen.height - 40 });

    // --- Notification API ---
    if (typeof Notification === 'undefined') {
      window.Notification = { permission: 'default' };
    }

    // --- Remove Playwright-specific properties ---
    delete window.__playwright;
    delete window.__pw_manual;
    delete window.__PW_inspect;
  };
}

export const stealthArgs = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--window-size=1366,768',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-logging',
  '--log-level=3',
  '--silent',
  '--no-startup-window',
  '--disable-popup-blocking'
];

export const stealthUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
