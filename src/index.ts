// Stealth variant of klura's PlaywrightDriver. Passes playwright-extra's
// patched chromium (with puppeteer-extra-plugin-stealth applied) to the base
// class so every browser launch ships the stealth DOM patches:
// navigator.webdriver false, chrome.runtime shimmed, plugin enumeration
// faked, WebGL vendor/renderer strings normalized, language/platform
// consistency enforced.
//
// Usage: install this package alongside `klura`, then point at it from
// `~/.klura/config.json`:
//
//   { "pool": { "driver": "klura-driver-playwright-stealth" } }
//
// The runtime's `resolveDriverClass` will require() this package and
// instantiate the default export.

// Import the driver class directly from klura's compiled `drivers/playwright`
// entry point, not the top-level `klura` barrel. The barrel eagerly constructs
// a Pool at module load, which reads `~/.klura/config.json` — so if the user
// has set `pool.driver` to this package, requiring `klura` from here would
// cause a circular load and the Pool would see a half-initialized exports
// object. Going straight at the driver file sidesteps that entirely.
import {
  PlaywrightDriver,
  type PlaywrightDriverOptions,
} from 'klura/dist/drivers/playwright';
import type { BrowserType } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: stealthChromium } = require('playwright-extra') as {
  chromium: BrowserType & { use: (plugin: unknown) => void };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require('puppeteer-extra-plugin-stealth') as () => unknown;
stealthChromium.use(StealthPlugin());

export class PlaywrightStealthDriver extends PlaywrightDriver {
  constructor(opts: PlaywrightDriverOptions = {}) {
    super({ ...opts, chromium: stealthChromium });
  }
}

export default PlaywrightStealthDriver;
