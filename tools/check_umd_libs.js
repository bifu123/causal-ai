// 验证其余本地 UMD 库在浏览器全局环境下能正确挂载：
//   vis-network -> window.vis.Network
//   socket.io-client -> window.io
//   three -> window.THREE
//   @tweenjs/tween.js -> window.TWEEN
//   easymde -> window.EasyMDE
// 用法：node tools/check_umd_libs.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function makeSandbox() {
  const sandbox = {
    console,
    navigator: { userAgent: 'node' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    document: {
      contentType: 'text/html',
      documentMode: 11,
      compatMode: 'CSS1Compat',
      documentElement: { style: {} },
      createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, innerHTML: '' }),
      createTextNode: (t) => t,
      createDocumentFragment: () => ({ appendChild() {} }),
      getElementsByTagName: () => [{ appendChild() {} }],
      head: { appendChild() {} },
      body: { appendChild() {}, style: {} },
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function load(sandbox, rel) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

const results = [];
function check(name, fn) {
  const sandbox = makeSandbox();
  try {
    fn(sandbox);
    results.push({ name, ok: true, detail: '' });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}

check('vis-network.min.js -> vis.Network', (sb) => {
  load(sb, 'static/js/vis-network.min.js');
  if (!sb.vis || typeof sb.vis.Network !== 'function') throw new Error('未挂载 window.vis.Network');
});

check('socket.io.min.js -> io', (sb) => {
  load(sb, 'static/js/socket.io.min.js');
  if (typeof sb.io !== 'function') throw new Error('未挂载 window.io');
});

check('three.min.js -> THREE (r128)', (sb) => {
  load(sb, 'static/js/three.min.js');
  if (!sb.THREE || typeof sb.THREE.Scene !== 'function') throw new Error('未挂载 window.THREE');
  if (sb.THREE.REVISION !== '128') throw new Error('THREE 版本不是 128，实际 ' + sb.THREE.REVISION);
});

check('tween.umd.js -> TWEEN', (sb) => {
  load(sb, 'static/js/tween.umd.js');
  const tween = sb.TWEEN || (sb.tween && sb.tween.TWEEN);
  if (!tween || typeof tween.Tween !== 'function') throw new Error('未挂载 window.TWEEN');
});

check('easymde.min.js -> EasyMDE', (sb) => {
  load(sb, 'static/js/easymde.min.js');
  if (typeof sb.EasyMDE !== 'function') throw new Error('未挂载 window.EasyMDE');
});

check('marked.min.js -> marked.parse', (sb) => {
  load(sb, 'static/js/marked.min.js');
  const marked = sb.marked || sb.window.marked;
  if (!marked || typeof marked.parse !== 'function') throw new Error('未挂载 window.marked');
  if (!/<p>测试<\/p>/.test(marked.parse('测试'))) throw new Error('marked.parse 输出异常');
});

for (const r of results) {
  console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : ' -> ' + r.detail));
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n全部通过' : `\n失败 ${failed} 项`);
if (failed) process.exitCode = 1;
