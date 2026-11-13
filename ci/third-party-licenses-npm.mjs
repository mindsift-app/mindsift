#!/usr/bin/env node
// Prints the licenses of the npm packages that end up in the app: the production dependencies of
// frontend/package-lock.json (entries without "dev" or "devOptional"), each with the license files of
// its installed package. Needs no packages of its own; run after npm ci.
// Usage: node ci/third-party-licenses-npm.mjs <frontend dir>  (writes to stdout)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'frontend';
const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
const licenseFile = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

const entries = Object.entries(lock.packages || {})
  .filter(([path, pkg]) => path.startsWith('node_modules/') && !pkg.dev && !pkg.devOptional)
  .sort(([a], [b]) => a.localeCompare(b));

let missing = 0;
for (const [path, pkg] of entries) {
  const pkgDir = join(dir, path);
  // Optional packages for another platform are not installed and not part of the build
  if (!existsSync(pkgDir)) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const files = readdirSync(pkgDir).filter((f) => licenseFile.test(f)).sort();
  console.log('='.repeat(80));
  console.log(`${name} ${pkg.version} (npm, ${pkg.license || 'license not stated'})`);
  console.log('='.repeat(80));
  if (files.length === 0) {
    missing++;
    console.error(`third-party-licenses: ${name} ${pkg.version} has no license file`);
    console.log(`The package ships no license file; its package.json states: ${pkg.license || 'nothing'}.`);
  }
  for (const f of files) {
    console.log(readFileSync(join(pkgDir, f), 'utf8').trimEnd());
    console.log();
  }
  console.log();
}
if (entries.length === 0) {
  console.error('third-party-licenses: no production dependencies found in package-lock.json');
  process.exit(1);
}
if (missing > 0) console.error(`third-party-licenses: ${missing} npm package(s) without a license file`);
