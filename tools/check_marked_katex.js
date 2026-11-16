// 验证本地 marked + katex + marked-katex-extension 的 UMD 组合可用：
// 模拟浏览器全局环境后依次加载三个脚本，再渲染一段含公式的 Markdown。
// 用法：node tools/check_marked_katex.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = {
  console,
  window: null,
  document: {
    contentType: 'text/html',
    documentMode: 11,
    compatMode: 'CSS1Compat',
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, innerHTML: '' }),
    createTextNode: (t) => t,
    head: { appendChild() {} },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

load('static/js/marked.min.js');
load('static/js/katex.min.js');
load('static/js/marked-katex-extension.umd.js');

const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
}

check('window.marked 存在', typeof sandbox.marked !== 'undefined' || typeof sandbox.window.marked !== 'undefined');
check('marked.parse 可用', typeof (sandbox.marked || sandbox.window.marked).parse === 'function');
check('window.katex 存在', typeof sandbox.katex === 'object' && typeof sandbox.katex.renderToString === 'function');
check('window.markedKatex 存在', typeof sandbox.markedKatex === 'function');

if (typeof sandbox.markedKatex === 'function') {
  const ext = sandbox.markedKatex({ throwOnError: false });
  check('markedKatex() 返回 extensions', Array.isArray(ext.extensions) && ext.extensions.length > 0);
  // marked v4 用法：marked.use({ extensions })
  const marked = sandbox.marked || sandbox.window.marked;
  marked.use({ extensions: ext.extensions });
  // 注意：marked-katex-extension 默认使用「标准」语法，行内 $ 前需要空格/开头
  const html = marked.parse('# 标题\n\n公式： $E=mc^2$\n\n段落 **加粗** 与 `code`');
  console.log('--- 渲染结果 ---\n' + html + '\n----------------');
  check('渲染出 <h1>', /<h1[^>]*>/.test(html));
  check('渲染出 KaTeX 公式', /katex/.test(html));
  check('渲染出 <strong>', /<strong>/.test(html));
}

for (const r of results) {
  console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n全部通过' : `\n失败 ${failed} 项`);
if (failed) process.exitCode = 1;
