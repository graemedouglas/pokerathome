/**
 * Updates the ADMIN_PASSWORD in the server .env file.
 * Usage: pnpm set-admin-password <new-password>
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const password = process.argv[2];
if (!password) {
  console.error('Usage: pnpm set-admin-password <new-password>');
  process.exit(1);
}

const envPath = resolve(__dirname, '../.env');
let content = '';
try {
  content = readFileSync(envPath, 'utf-8');
} catch {
  // .env doesn't exist yet — will create it
}

if (/^ADMIN_PASSWORD=.*/m.test(content)) {
  content = content.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${password}`);
} else {
  content = content.trimEnd() + `\nADMIN_PASSWORD=${password}\n`;
}

writeFileSync(envPath, content);
console.log('Admin password updated. Restart the server for changes to take effect.');
