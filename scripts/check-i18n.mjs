import fs from 'node:fs';
import path from 'node:path';

const localeDirectory = path.resolve('public/locales');
const localeFiles = ['en.json', 'zh.json', 'fr.json', 'de.json', 'it.json', 'es.json'];
const locales = Object.fromEntries(
  localeFiles.map((file) => [
    file,
    JSON.parse(fs.readFileSync(path.join(localeDirectory, file), 'utf8')),
  ]),
);

const referenceKeys = Object.keys(locales['en.json']).sort();

for (const file of localeFiles) {
  const locale = locales[file];
  const missing = referenceKeys.filter((key) => !Object.hasOwn(locale, key));
  const extra = Object.keys(locale).filter((key) => !Object.hasOwn(locales['en.json'], key));

  if (missing.length || extra.length) {
    console.error(`${file}: missing=${missing.length}, extra=${extra.length}`);
    if (missing.length) console.error('Missing keys:', missing);
    if (extra.length) console.error('Extra keys:', extra);
    process.exitCode = 1;
  }
}

const sources = [
  'public/index.html',
  'public/views/ledger.html',
  'public/js/features/ledger/ledger.js',
];
const usedKeys = new Set();

for (const file of sources) {
  const source = fs.readFileSync(path.resolve(file), 'utf8');
  for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) usedKeys.add(match[1]);
  for (const match of source.matchAll(/data-i18n(?:-placeholder|-aria-label)?=['"]([^'"]+)['"]/g)) {
    usedKeys.add(match[1]);
  }
}

for (const file of localeFiles) {
  const missing = [...usedKeys].filter((key) => !Object.hasOwn(locales[file], key));
  if (missing.length) {
    console.error(`${file}: missing ${missing.length} keys used by the ledger UI`);
    console.error(missing);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log(`i18n-ok: ${localeFiles.length} locales, ${referenceKeys.length} keys, ${usedKeys.size} ledger UI keys`);
}
