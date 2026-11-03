const { cpSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

if (!process.env.DESTINATION_DIR) throw new Error('DESTINATION_DIR is required for the Builder build');
const destination = resolve(process.env.DESTINATION_DIR);
if (destination === process.cwd()) throw new Error('Build destination must differ from the source root');
mkdirSync(destination, { recursive: true });
for (const file of ['index.js', 'cache', 'middleware', 'routes', 'node_modules', 'package.json', 'package-lock.json']) {
  cpSync(file, resolve(destination, file), { recursive: true, verbatimSymlinks: true });
}
