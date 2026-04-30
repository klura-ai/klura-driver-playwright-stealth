# klura-driver-playwright-stealth

Stealth Playwright driver for [klura](https://www.npmjs.com/package/klura). Extends klura's built-in `PlaywrightDriver` with [`playwright-extra`](https://www.npmjs.com/package/playwright-extra) and [`puppeteer-extra-plugin-stealth`](https://www.npmjs.com/package/puppeteer-extra-plugin-stealth) applied at launch, so every browser context ships the stealth DOM patches:

- `navigator.webdriver` returns `false`
- `chrome.runtime` shimmed
- Plugin enumeration faked
- WebGL vendor/renderer strings normalized
- Language / platform consistency enforced

This is a real browser behind the patches — a real user is expected to drive it via klura's remote viewer. Stealth here fixes automation-fingerprint leaks so the browser looks like what it actually is.

## Install

```bash
npm install klura klura-driver-playwright-stealth playwright
```

## Configure

Point `pool.driver` at this package in `~/.klura/config.json`:

```json
{
  "pool": {
    "mode": "local",
    "driver": "klura-driver-playwright-stealth"
  }
}
```

Klura's pool loader will `require()` the package and use its default export. You can also pass a relative or absolute path to a custom driver that extends `PlaywrightDriver` the same way — see `klura://reference#drivers` for the BYO driver contract.

## Docker variant

The `klura-browser:playwright-stealth` Docker image is a separate stealth path for `pool.mode: "docker"` and does not use this package — it bakes stealth into the container-side driver instead.

## License

BUSL-1.1
