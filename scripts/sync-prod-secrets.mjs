import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Pushes every KEY=VALUE line from .secrets.production into a Cloudflare Pages
// project as production secrets. Same file format as .dev.vars (see
// .dev.vars.example). BOOKING_DB is a binding, not a secret: keep it out of the file.
const file = '.secrets.production';
const project = process.argv[2] ?? process.env.PAGES_PROJECT;
if (!project) {
  console.error('Usage: npm run secrets:sync -- <pages-project-name>');
  process.exit(1);
}

const entries = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter(line => line.trim() && !line.trim().startsWith('#'))
  .map(line => {
    const i = line.indexOf('=');
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  })
  .filter(([k, v]) => k && v);
if (!entries.length) {
  console.error(`${file} has no KEY=VALUE lines`);
  process.exit(1);
}

let failed = 0;
for (const [key, value] of entries) {
  const result = spawnSync('npx', ['wrangler', 'pages', 'secret', 'put', key, '--project-name', project],
    {input: value, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32'});
  if (result.status === 0) console.log(`OK ${key}`);
  else { console.log(`FAILED ${key}`); failed++; }
}
process.exit(failed ? 1 : 0);
