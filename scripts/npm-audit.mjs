import { spawnSync } from 'node:child_process';

const workspace = process.argv[2];
if (!workspace) {
  console.error('Usage: node scripts/npm-audit.mjs <workspace>');
  process.exit(2);
}

const allowedAdvisories = new Set([
  // No patched braces release exists. Current uses only process trusted, static
  // build-time glob patterns in next-pwa and eslint-config-next.
  'GHSA-vfj7-8cjw-p6xm',
  // No patched picomatch release exists (<= 4.0.7 affected). It is reached only
  // via typeorm/tinyglobby with static entity/migration globs and via next-pwa
  // build tooling; no user-controlled input is ever used as a glob pattern.
  // Remove once a patched picomatch ships.
  'GHSA-fc5q-39xc-vjpf',
]);
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const result = spawnSync('npm', ['audit', `--workspace=${workspace}`, '--json'], { encoding: 'utf8' });

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
if (result.error || report.error) {
  console.error(result.error?.message || report.error.summary || 'npm audit failed');
  process.exit(result.status || 1);
}

const vulnerabilities = report.vulnerabilities ?? {};

function advisoriesFor(name, visited = new Set()) {
  if (visited.has(name)) return [];
  visited.add(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return [];
  return vulnerability.via.flatMap((via) =>
    typeof via === 'string' ? advisoriesFor(via, visited) : [via],
  );
}

const failures = [];
const allowed = new Set();
for (const name of Object.keys(vulnerabilities)) {
  for (const advisory of advisoriesFor(name)) {
    if ((severityRank[advisory.severity] ?? 0) < severityRank.high) continue;
    const id = advisory.url.split('/').at(-1);
    if (allowedAdvisories.has(id)) allowed.add(id);
    else failures.push(`${id}: ${advisory.title}`);
  }
}

for (const id of allowed) console.warn(`Allowing ${id}: no patched release is available`);
if (failures.length > 0) {
  console.error(`High or critical vulnerabilities found in ${workspace}:`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`No unapproved high or critical vulnerabilities found in ${workspace}`);
