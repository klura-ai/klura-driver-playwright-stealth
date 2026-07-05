// Stealth variant of klura's PlaywrightDriver. Ships two independent layers of
// fingerprint hardening so every launched browser looks like a browser a real
// user is sitting behind (which, via the remote viewer, they are):
//
//  1. DOM-level patches (puppeteer-extra-plugin-stealth): navigator.webdriver
//     false, chrome.runtime shimmed, plugin enumeration faked, WebGL
//     vendor/renderer strings normalized, language/platform consistency.
//
//  2. CDP-level patch (rebrowser-playwright drop-in): suppresses the
//     `Runtime.enable` execution-context leak that lets a page observe it is
//     being driven over the DevTools Protocol. This is the leak that DOM
//     patches structurally cannot reach — it lives in the protocol client, not
//     in any page-visible property — and it is the signal challenge widgets
//     lean on hardest. The drop-in is a pre-patched playwright-core; we pass its
//     chromium through playwright-extra's `addExtra` so the DOM plugin layers on
//     top.
//
// Usage: install this package alongside `@klura/runtime`, then point at it from
// `~/.klura/config.json`:
//
//   { "pool": { "driver": "@klura/driver-playwright-stealth" } }
//
// The runtime's `resolveDriverClass` will require() this package and
// instantiate the default export.

// The CDP fix reads these at the moment a context is acquired, so they must be
// set before rebrowser-playwright is required. `addBinding` is the recommended
// mode (lazy execution context via Runtime.addBinding, no full Runtime.enable);
// `util` keeps the isolated world off the tell-tale `__playwright_utility_world__`
// name. We default them rather than force them, so an operator can still tune
// or disable via env — but a disabled value is a silent downgrade, so we warn
// on it below.
process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE ||= 'addBinding';
process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME ||= 'util';

// Import the driver class directly from the runtime's compiled
// `drivers/playwright` entry point, not the top-level `@klura/runtime` barrel.
// The barrel eagerly constructs a Pool at module load, which reads
// `~/.klura/config.json` — so if the user has set `pool.driver` to this
// package, requiring `@klura/runtime` from here would cause a circular load and
// the Pool would see a half-initialized exports object. Going straight at the
// driver file sidesteps that entirely.
import {
  PlaywrightDriver,
  type PlaywrightDriverOptions,
} from '@klura/runtime/dist/drivers/playwright';
import type { BrowserType } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addExtra } = require('playwright-extra') as {
  addExtra: (mod: unknown) => BrowserType & { use: (plugin: unknown) => void };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rebrowser = require('rebrowser-playwright') as { chromium: BrowserType };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require('puppeteer-extra-plugin-stealth') as () => unknown;

const stealthChromium = addExtra(rebrowser.chromium);
stealthChromium.use(StealthPlugin());

warnIfCdpFixInactive();

// A silently-degraded stealth driver is worse than none: the operator believes
// they are hardened and behaves accordingly. Confirm at load that the CDP fix is
// both present (we resolved the pre-patched core, not a stray stock one) and
// armed (fix mode not disabled), and shout on stderr if either fails.
function warnIfCdpFixInactive(): void {
  const warn = (msg: string) =>
    console.warn(`[klura-stealth] CDP execution-context leak NOT patched: ${msg}`);

  if (process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE === '0') {
    warn('REBROWSER_PATCHES_RUNTIME_FIX_MODE=0 disables the fix — unset it or use "addBinding".');
    return;
  }
  if (process.env.REBROWSER_PATCHES_UTILITY_WORLD_NAME === '0') {
    warn('REBROWSER_PATCHES_UTILITY_WORLD_NAME=0 restores the __playwright_utility_world__ tell.');
  }
  try {
    // The pre-patched core is nested under rebrowser-playwright. Resolving its
    // package name and confirming the fork tag is the cheapest proof the
    // protocol client that will actually run is the patched one.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const corePkg = require('rebrowser-playwright/package.json') as {
      name?: string;
      version?: string;
    };
    if (!corePkg.name?.startsWith('rebrowser-')) {
      warn(`resolved "${corePkg.name}" instead of the rebrowser-playwright drop-in.`);
    }
  } catch (err) {
    warn(`could not resolve rebrowser-playwright: ${String(err)}`);
  }

  // The __pwInitScripts leak is closed by an on-disk patch (postinstall). If the
  // marker is absent, the patch never ran or failed to match — the page is
  // exposing window.__pwInitScripts and the operator must know.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('path') as typeof import('path');
    const rebrowserDir = nodePath.dirname(require.resolve('rebrowser-playwright/package.json'));
    const coreDir = nodePath.dirname(
      require.resolve('playwright-core/package.json', { paths: [rebrowserDir] }),
    );
    const pageJs = nodePath.join(coreDir, 'lib', 'server', 'page.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = (require('fs') as typeof import('fs')).readFileSync(pageJs, 'utf8');
    if (!src.includes('__klISG')) {
      console.warn(
        '[klura-stealth] window.__pwInitScripts leak NOT patched — run ' +
          '`npm run patch:stealth` in the driver package.',
      );
    }
  } catch {
    // resolution failure is already surfaced by the rebrowser check above
  }
}

// Common real desktop viewports (top of the global usage distribution). We
// avoid 1280x720 — that is the value Playwright applies when no viewport is
// pinned, so a page seeing it can infer automation. Picking from a spread of
// genuinely common sizes both dodges that specific tell and avoids becoming a
// new static signature of its own.
const REALISTIC_VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const PLAYWRIGHT_DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export class PlaywrightStealthDriver extends PlaywrightDriver {
  constructor(opts: PlaywrightDriverOptions = {}) {
    super({ ...opts, chromium: stealthChromium });
  }

  protected override _resolveViewport(options: {
    viewport?: { width: number; height: number };
  }): { width: number; height: number } {
    const v = options.viewport;
    // Honor a caller-pinned viewport unless it is the Playwright default —
    // that value is a tell, so under the stealth driver we treat it as unset.
    if (
      v &&
      !(v.width === PLAYWRIGHT_DEFAULT_VIEWPORT.width && v.height === PLAYWRIGHT_DEFAULT_VIEWPORT.height)
    ) {
      return v;
    }
    const i = Math.floor(Math.random() * REALISTIC_VIEWPORTS.length);
    return REALISTIC_VIEWPORTS[i];
  }
}

export default PlaywrightStealthDriver;
