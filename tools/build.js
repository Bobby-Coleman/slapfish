// Inlines the shared sim and the client into one self-contained HTML file (dist/slapfish.html).
// Client modules imported with `import { a, b } from './x.js'` are bundled in dependency order,
// each wrapped in its own scope so their private helpers can't clash with game.js.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'shared/sim.js'), 'utf8');

const LOCAL_IMPORT = /^import\s*\{[^}]*\}\s*from\s*'\.\/([\w-]+\.js)';\s*$/gm;
const THREE_IMPORT = /^import \* as THREE from 'three';\s*$/m;
const done = new Set();
const chunks = [];
function bundle(file, isEntry) {
  if (done.has(file)) return;
  done.add(file);
  let src = fs.readFileSync(path.join(root, 'client', file), 'utf8');
  for (const m of src.matchAll(LOCAL_IMPORT)) bundle(m[1], false);
  src = src.replace(LOCAL_IMPORT, '').replace(THREE_IMPORT, '');
  if (isEntry) { chunks.push(src); return; }
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/gm)].map((m) => m[1]);
  src = src.replace(/^export\s+/gm, '');
  chunks.push(`// ---- ${file}\nconst { ${names.join(', ')} } = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();\n`);
}
bundle('game.js', true);
const game = "import * as THREE from 'three';\n" + chunks.join('\n');

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
