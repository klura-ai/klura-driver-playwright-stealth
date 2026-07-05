#!/usr/bin/env node
// Neutralizes the `window.__pwInitScripts` main-world leak.
//
// playwright-core wraps every init script in a dedup guard that reads and
// writes `globalThis.__pwInitScripts` (server/page.js, class InitScript). That
// object is created in the page's main world, so any page can read
// `window.__pwInitScripts` and conclude it is being driven by Playwright — the
// property name is a static, well-known signature. rebrowser-patches does not
// touch it ("no fix available").
//
// The wrapper is built from a lexical `InitScript` binding inside page.js, so
// it cannot be intercepted from outside the module at runtime. We rewrite the
// binding's source template to key the dedup store off a name randomized once
// per process, so there is no stable property for a page to look up. The dedup
// semantics are unchanged; only the property name differs.
//
// Idempotent: re-running is a no-op once the marker is present. A version bump
// of rebrowser-playwright that reshapes the template will fail the match and
// print a loud warning rather than silently leave the leak in place.

const fs = require('fs');
const path = require('path');

const MARKER = '__klISG';
const ORIGINAL = 'globalThis.__pwInitScripts';
const RANDOM_DECL =
  "const __klISG = '_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);\n";

function resolveCorePageJs() {
  // rebrowser-playwright nests its own patched playwright-core; resolve from
  // the drop-in package so we hit the exact core that will run. playwright-core
  // does not export deep subpaths, so resolve its package.json (which is
  // exported) and build the path from its directory.
  const rebrowserDir = path.dirname(require.resolve('rebrowser-playwright/package.json'));
  const coreDir = path.dirname(
    require.resolve('playwright-core/package.json', { paths: [rebrowserDir] }),
  );
  return path.join(coreDir, 'lib', 'server', 'page.js');
}

function main() {
  let file;
  try {
    file = resolveCorePageJs();
  } catch (err) {
    console.warn(`[klura-stealth] pwInitScripts patch skipped — cannot resolve core: ${String(err)}`);
    return;
  }

  const src = fs.readFileSync(file, 'utf8');

  if (src.includes(MARKER)) {
    return; // already patched
  }
  if (!src.includes(ORIGINAL)) {
    console.warn(
      `[klura-stealth] pwInitScripts patch DID NOT APPLY — the InitScript template in ` +
        `${file} has changed shape. window.__pwInitScripts leak is NOT neutralized. ` +
        `Update scripts/patch-pw-initscripts.js for this playwright-core version.`,
    );
    return;
  }

  const patched = src
    // Randomized name declared once per process, inserted just above the class.
    .replace('class InitScript {', `${RANDOM_DECL}class InitScript {`)
    // Key the dedup store off that name instead of the static one. JSON.stringify
    // runs when page.js builds each script's source, so the browser sees a plain
    // string literal — e.g. globalThis["_ab12cd34ef"].
    .split(ORIGINAL)
    .join('globalThis[${JSON.stringify(__klISG)}]');

  fs.writeFileSync(file, patched, 'utf8');
  console.warn('[klura-stealth] pwInitScripts patch applied — window.__pwInitScripts leak neutralized.');
}

main();
