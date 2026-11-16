// 静态资源本地化自检脚本（无需启动完整应用）：
//   1. 扫描 templates/*.html 中的 src/href 引用；
//   2. 检查是否还存在外部 CDN / Google Fonts 依赖；
//   3. 检查所有 /static/... 引用在磁盘上真实存在；
//   4. 检查 CSS 里的 url(...) 字体引用是否可解析。
// 用法：node tools/check_local_assets.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_DIR = path.join(ROOT, 'templates');
const STATIC_DIR = path.join(ROOT, 'static');
const EXTERNAL_RE = /^(https?:)?\/\//i;

let problems = 0;

function fail(msg) {
  problems += 1;
  console.log('  ✗ ' + msg);
}

function ok(msg) {
  console.log('  ✓ ' + msg);
}

function resolveStatic(url) {
  // '/static/x/y.css?v=1' -> <ROOT>/static/x/y.css
  const clean = url.split('?')[0].split('#')[0];
  return path.join(STATIC_DIR, clean.replace(/^\/static\//, ''));
}

function checkCssUrls(cssFile, seen) {
  if (seen.has(cssFile)) return;
  seen.add(cssFile);
  const text = fs.readFileSync(cssFile, 'utf8');
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ref = m[1].trim();
    if (ref.startsWith('data:') || ref.startsWith('#')) continue;
    if (EXTERNAL_RE.test(ref)) {
      fail(path.basename(cssFile) + ' 仍引用外部资源: ' + ref);
      continue;
    }
    let target;
    if (ref.startsWith('/static/')) {
      target = resolveStatic(ref);
    } else if (ref.startsWith('/')) {
      continue; // 由后端路由处理，非静态资源
    } else {
      target = path.join(path.dirname(cssFile), ref);
    }
    if (!fs.existsSync(target)) {
      fail(path.basename(cssFile) + ' 引用的文件缺失: ' + ref);
    }
  }
}

const htmlFiles = fs.readdirSync(HTML_DIR).filter((f) => f.endsWith('.html'));
const cssSeen = new Set();

for (const file of htmlFiles) {
  console.log('\n[' + file + ']');
  const text = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
  const re = /<(script|link)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  const refs = [];
  while ((m = re.exec(text)) !== null) {
    refs.push({ tag: m[1].toLowerCase(), url: m[2] });
  }
  if (refs.length === 0) console.log('  (无外部/静态资源引用)');
  for (const ref of refs) {
    if (EXTERNAL_RE.test(ref.url)) {
      fail('外部依赖未本地化: ' + ref.url);
      continue;
    }
    if (ref.url.startsWith('/static/')) {
      const target = resolveStatic(ref.url);
      if (!fs.existsSync(target)) {
        fail('缺失静态文件: ' + ref.url);
      } else {
        ok(ref.url);
        if (target.endsWith('.css')) checkCssUrls(target, cssSeen);
      }
    }
  }
}

console.log('\n================ 结果 ================');
if (problems === 0) {
  console.log('全部通过：页面不再依赖任何外部 CDN / Google Fonts。');
} else {
  console.log('发现 ' + problems + ' 个问题，请修复后重跑。');
  process.exitCode = 1;
}
