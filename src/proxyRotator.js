/**
 * Proxy rotator — fetches free proxies and rotates them per attempt
 * to avoid Google reCAPTCHA rate limiting on a single IP.
 */

let cachedProxies = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let proxyIndex = 0;

/**
 * Fetch fresh proxies from free public APIs
 */
async function fetchFreeProxies() {
  const sources = [
    {
      url: 'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=json&limit=50&protocol=http&timeout=5000',
      parse: (data) => {
        if (data.proxies) return data.proxies.map(p => p.proxy);
        return [];
      }
    },
    {
      url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
      parse: (text) => {
        const lines = text.split('\n').filter(l => l.trim()).slice(0, 50);
        return lines.map(l => `http://${l.trim()}`);
      },
      isText: true
    },
    {
      url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
      parse: (text) => {
        const lines = text.split('\n').filter(l => l.trim()).slice(0, 50);
        return lines.map(l => `http://${l.trim()}`);
      },
      isText: true
    },
    {
      url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
      parse: (text) => {
        const lines = text.split('\n').filter(l => l.trim()).slice(0, 30);
        return lines.map(l => `socks5://${l.trim()}`);
      },
      isText: true
    },
    {
      url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
      parse: (text) => {
        const lines = text.split('\n').filter(l => l.trim()).slice(0, 30);
        return lines.map(l => `socks5://${l.trim()}`);
      },
      isText: true
    },
    {
      url: 'https://raw.githubusercontent.com/ErcinDedeworkaround/proxies/main/proxies/http.txt',
      parse: (text) => {
        const lines = text.split('\n').filter(l => l.trim()).slice(0, 30);
        return lines.map(l => `http://${l.trim()}`);
      },
      isText: true
    }
  ];

  const allProxies = [];

  for (const source of sources) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;

      let proxies;
      if (source.isText) {
        const text = await res.text();
        proxies = source.parse(text);
      } else {
        const data = await res.json();
        proxies = source.parse(data);
      }

      if (proxies.length > 0) {
        allProxies.push(...proxies);
        console.log(`[ProxyRotator] Got ${proxies.length} proxies from source`);
      }
    } catch (err) {
      // Silently skip failed sources
    }
  }

  // Shuffle the proxies
  for (let i = allProxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
  }

  return allProxies;
}

/**
 * Test TCP connectivity to a SOCKS5 proxy (just check if port is open)
 */
async function testTcpConnect(proxyUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(proxyUrl);
      const net = require('node:net');
      const socket = net.createConnection({
        host: parsed.hostname,
        port: parsed.port || 1080,
        timeout: 5000
      });
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Test if a proxy is working by making a simple HTTP GET through it.
 */
async function testProxy(proxyUrl) {
  return new Promise((resolve) => {
    try {
      const proxyParsed = new URL(proxyUrl);
      const http = require('node:http');
      // Use HTTP GET through proxy (forward proxy method)
      const req = http.request({
        host: proxyParsed.hostname,
        port: proxyParsed.port || 8080,
        path: 'http://httpbin.org/ip',
        method: 'GET',
        timeout: 8000,
        headers: { Host: 'httpbin.org' }
      });
      req.on('response', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          req.destroy();
          resolve(res.statusCode === 200 && data.includes('origin'));
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Get the next proxy to use. Returns null if no proxy available (use direct).
 * Format: { server: 'http://ip:port' } compatible with Playwright
 */
export async function getNextProxy(config) {
  // If user configured a specific proxy, always use that
  const envProxy = config?.proxyUrl || process.env.PROXY_URL;
  if (envProxy) {
    return { server: envProxy };
  }

  // Only fetch free proxies if enabled
  const useFree = process.env.USE_FREE_PROXIES === 'true';
  if (!useFree) return null;

  // Refresh proxy list if stale
  if (Date.now() - lastFetchTime > CACHE_TTL_MS || cachedProxies.length === 0) {
    console.log('[ProxyRotator] Fetching fresh proxy list...');
    cachedProxies = await fetchFreeProxies();
    lastFetchTime = Date.now();
    proxyIndex = 0;
    console.log(`[ProxyRotator] ${cachedProxies.length} proxies available`);
  }

  if (cachedProxies.length === 0) {
    return null; // No proxies available, use direct connection
  }

  // Test all proxies in parallel batches (both HTTP and SOCKS5)
  const BATCH_SIZE = 20;
  const MAX_BATCHES = 5;
  for (let batch = 0; batch < MAX_BATCHES && cachedProxies.length > batch * BATCH_SIZE; batch++) {
    const candidates = cachedProxies.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
    if (candidates.length === 0) break;

    console.log(`[ProxyRotator] Testing batch ${batch + 1} (${candidates.length} proxies)...`);
    const results = await Promise.all(
      candidates.map(async (proxy) => {
        const server = proxy.startsWith('socks5://') ? proxy : (proxy.startsWith('http') ? proxy : `http://${proxy}`);
        // For SOCKS5: just test TCP connectivity to the proxy port
        const works = proxy.startsWith('socks5://') ? await testTcpConnect(proxy) : await testProxy(server);
        return { proxy, server, works };
      })
    );

    // Remove dead proxies from cache
    const dead = results.filter(r => !r.works).map(r => r.proxy);
    cachedProxies = cachedProxies.filter(p => !dead.includes(p));

    // Return first working one
    const working = results.find(r => r.works);
    if (working) {
      console.log(`[ProxyRotator] Found working proxy: ${working.server}`);
      return { server: working.server };
    }
  }

  console.warn('[ProxyRotator] No working proxy found after testing. Using direct.');
  return null;
}

/**
 * Mark a proxy as bad and remove it from the pool
 */
export function markProxyBad(proxyServer) {
  cachedProxies = cachedProxies.filter(p => {
    const formatted = p.startsWith('http') ? p : `http://${p}`;
    return formatted !== proxyServer;
  });
  console.log(`[ProxyRotator] Removed bad proxy. ${cachedProxies.length} remaining.`);
}

/**
 * Get proxy config for Playwright context launch
 */
export async function getPlaywrightProxy(config) {
  const proxy = await getNextProxy(config);
  if (!proxy) return {};
  console.log(`[ProxyRotator] Using proxy: ${proxy.server}`);
  return { proxy };
}
