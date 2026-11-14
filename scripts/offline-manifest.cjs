const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve('dist');
function files(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const assets = files(root).filter(file => !['sw.js', 'offline-manifest.json'].includes(path.basename(file)));
const manifest = assets.map(file => '/' + path.relative(root, file).split(path.sep).join('/'));
fs.writeFileSync(path.join(root, 'offline-manifest.json'), JSON.stringify(manifest));
const version = crypto.createHash('sha256');
for (const file of assets) version.update(fs.readFileSync(file));
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').replace('locallearn-shell-v1', `locallearn-shell-${version.digest('hex').slice(0, 16)}`);
fs.writeFileSync(path.join(root, 'sw.js'), worker);
console.log(`Prepared ${assets.length} files for offline web installation.`);
