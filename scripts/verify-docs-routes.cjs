#!/usr/bin/env node
// ============================================================
//  verify-docs-routes — every link in the docs sidebar must have a page
//
//  The sidebar is a hand-written list (app/docs/_lib/docsNav.ts) and the pages
//  are folders on disk. Nothing connects the two, so a renamed folder or a
//  section added to the nav before its page exists gives a link that 404s —
//  and nothing else in the build notices, because Next resolves routes at
//  request time.
//
//  This is the check that would have caught the mistake made while moving the
//  docs into the editor: /docs/controls looks like a page in the tree, but it
//  is only a folder — the pages are /docs/controls/library and .../mockup.
//
//  Usage: node scripts/verify-docs-routes.cjs
// ============================================================

const fs = require('fs');
const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { DOCS_SECTIONS } = require('../app/docs/_lib/docsNav');

const DOCS_DIR = path.join(root, 'app', 'docs');

let assertions = 0;
const failures = [];
function check(ok, message) {
  assertions++;
  if (!ok) failures.push(message);
}

// ---------- every nav href resolves to a page.tsx ----------
const linked = new Set();
for (const section of DOCS_SECTIONS) {
  check(section.links.length > 0, `section "${section.title}" has no links`);
  for (const link of section.links) {
    check(link.href === '/docs' || link.href.startsWith('/docs/'),
      `"${link.label}" points outside the docs: ${link.href}`);
    const rel = link.href.replace(/^\/docs\/?/, '');
    const file = path.join(DOCS_DIR, rel, 'page.tsx');
    check(fs.existsSync(file),
      `"${link.label}" (${link.href}) has no page — expected ${path.relative(root, file)}`);
    check(!linked.has(link.href), `${link.href} is listed twice in the sidebar`);
    linked.add(link.href);
  }
}

// ---------- and every page on disk is reachable from the sidebar ----------
// The other direction matters too: a page nobody links to is a page nobody
// reads, and the docs have no search of their own to fall back on.
function walk(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const next = path.join(dir, entry.name);
    const href = `${prefix}/${entry.name}`;
    if (fs.existsSync(path.join(next, 'page.tsx'))) {
      check(linked.has(href), `${href} exists on disk but no sidebar link reaches it`);
    }
    walk(next, href);
  }
}
check(fs.existsSync(path.join(DOCS_DIR, 'page.tsx')), 'the docs index page is missing');
walk(DOCS_DIR, '/docs');

if (failures.length) {
  console.error(`\nDocs route verification FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`Docs route verification passed (${assertions} assertions; ${linked.size} pages, sidebar and disk agree).`);
