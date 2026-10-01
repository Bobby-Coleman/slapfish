// Inlines the shared sim and the client into one self-contained HTML file (dist/slapfish.html).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'shared/sim.js'), 'utf8');
const game = fs.readFileSync(path.join(root, 'client/game.js'), 'utf8');
html = html.replace('<script src="../shared/sim.js"></script>', () => '<script>\n' + sim + '\n</script>');
html = html.replace('<script type="module" src="game.js"></script>', () => '<script type="module">\n' + game + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/slapfish.html'), html);
console.log('wrote dist/slapfish.html', html.length, 'bytes');

// Artifact variant: the host wraps the page in its own document skeleton.
const art = html
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/<\/head>\s*<body>/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
fs.writeFileSync(path.join(root, 'dist/slapfish-artifact.html'), art);
console.log('wrote dist/slapfish-artifact.html');
