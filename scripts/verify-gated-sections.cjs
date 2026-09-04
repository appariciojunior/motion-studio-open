#!/usr/bin/env node
// ============================================================
//  verify-gated-sections — the gate has to close the ROUTE, not the button
//
//  3D and Web ship unfinished, so a built app closes them. The failure mode
//  this guards against is the obvious half-fix: drop the buttons from the rail
//  and leave the routes resolving, so anyone who types /web still lands in the
//  Web stage. Every panel and stage reads its section from sectionFromPathname,
//  so that function is the door — and this suite opens it from the outside.
//
//  Boards is gated too, and that decision costs a feature: BoardExportBar is the
//  only caller of downloadSceneZip, and DesktopEditor only mounts it while the
//  board section is active, so a built app has no route to the React component
//  export. The cost is asserted below rather than left to memory — if the export
//  ever gets a home outside Boards, that assertion is the one to come back to.
//
//  Usage: node scripts/verify-gated-sections.cjs
// ============================================================

const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

// The flag reads process.env at module load, so each scenario needs the module
// graph freshly evaluated — hence the require-cache purge rather than one import.
function loadNav(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const key of Object.keys(require.cache)) {
    if (key.includes('navSections') || key.includes('deployment')) delete require.cache[key];
  }
  try {
    return require('../lib/navSections');
  } finally {
    process.env = saved;
  }
}

let assertions = 0;
const failures = [];
function check(ok, message) {
  assertions++;
  if (!ok) failures.push(message);
}

const GATED = ['3d', 'web', 'board'];
const OPEN = ['projects', 'library', 'mockup'];

// ---------- closed: a production build with no override ----------
{
  const nav = loadNav({ NODE_ENV: 'production', NEXT_PUBLIC_EXPERIMENTS: undefined });
  for (const id of GATED) {
    check(!nav.isSectionAvailable(id), `${id} must be unavailable in a production build`);
    check(nav.sectionFromPathname(`/${id}`) === nav.DEFAULT_SECTION,
      `/${id} must resolve to the default section, not to ${id} — the route is the door`);
    // Visible but closed: the rail still lists it (greyed, inert), so it has to
    // stay in NAV_SECTIONS. Dropping it from the list would take the label away
    // and leave only the route gate, which is not what was asked for.
    check(nav.NAV_SECTIONS.some((s) => s.id === id),
      `${id} must remain listed so the rail can draw it greyed out`);
  }
  for (const id of OPEN) {
    check(nav.isSectionAvailable(id), `${id} must stay available`);
    check(nav.sectionFromPathname(`/${id}`) === id, `/${id} must still resolve to ${id}`);
  }
  // Nothing openable may be experimental, and nothing experimental may be
  // openable — the two groups have to line up, or a section added later without
  // `gated` would quietly ship inside the Experiments drawer.
  for (const section of nav.NAV_SECTIONS) {
    check(!!section.experimental === !nav.isSectionAvailable(section.id),
      `${section.id}: experimental and gated must agree in a built app`);
  }
}

// ---------- open: development, and an explicit override ----------
for (const env of [
  { NODE_ENV: 'development', NEXT_PUBLIC_EXPERIMENTS: undefined },
  { NODE_ENV: 'production', NEXT_PUBLIC_EXPERIMENTS: '1' },
]) {
  const nav = loadNav(env);
  const label = env.NEXT_PUBLIC_EXPERIMENTS === '1' ? 'explicit override' : 'development';
  for (const id of GATED) {
    check(nav.isSectionAvailable(id), `${id} must be reachable under ${label}`);
    check(nav.sectionFromPathname(`/${id}`) === id, `/${id} must resolve to ${id} under ${label}`);
  }
}

// ---------- an explicit 0 closes them even in development ----------
{
  const nav = loadNav({ NODE_ENV: 'development', NEXT_PUBLIC_EXPERIMENTS: '0' });
  for (const id of GATED) {
    check(!nav.isSectionAvailable(id), `${id} must close when NEXT_PUBLIC_EXPERIMENTS=0`);
  }
}

// ---------- unknown paths still fall back ----------
{
  const nav = loadNav({ NODE_ENV: 'production' });
  check(nav.sectionFromPathname('/nope') === nav.DEFAULT_SECTION, 'unknown path falls back');
  check(nav.sectionFromPathname('/') === nav.DEFAULT_SECTION, 'index falls back');
  check(nav.sectionFromPathname(null) === nav.DEFAULT_SECTION, 'null path falls back');
}

if (failures.length) {
  console.error(`\nGated-section verification FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`Gated-section verification passed (${assertions} assertions; ${GATED.join(', ')} closed at the route, ${OPEN.join(', ')} open).`);
