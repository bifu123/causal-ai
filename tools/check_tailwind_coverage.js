// 检查 Tailwind 预编译产物是否覆盖模板里用到的工具类：
// 从 templates/2d_main.html、3d_main.html 提取 class 属性中的类名，
// 逐个确认 static/css/tailwind.min.css 中都有对应选择器。
// 用法：node tools/check_tailwind_coverage.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS = path.join(ROOT, 'static', 'css', 'tailwind.min.css');
const FILES = ['templates/2d_main.html', 'templates/3d_main.html'];

// Tailwind 前缀样式，其余类名由各页面自己的 CSS 定义（如 2d_main.css），此处只做提示
const TAILWIND_PREFIXES = [
  'bg-', 'text-', 'border-', 'flex', 'grid', 'hidden', 'block', 'inline', 'items-', 'justify-',
  'p-', 'px-', 'py-', 'pt-', 'pb-', 'pl-', 'pr-', 'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-',
  'w-', 'h-', 'min-', 'max-', 'space-', 'gap-', 'rounded', 'shadow', 'overflow', 'relative',
  'absolute', 'fixed', 'sticky', 'z-', 'cursor-', 'opacity-', 'transition', 'duration-',
  'font-', 'leading-', 'tracking-', 'truncate', 'uppercase', 'whitespace-', 'break-',
  'top-', 'right-', 'bottom-', 'left-', 'inset-', 'col-', 'row-', 'order-', 'content-',
  'pointer-events-', 'select-', 'resize', 'align-', 'object-', 'aspect-',
];

const css = fs.readFileSync(CSS, 'utf8');
const classes = new Set();

for (const rel of FILES) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const re = /class\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }
}

function escapeClass(cls) {
  // Tailwind 输出时转义了 / : . [ ] 等字符
  return cls.replace(/([/:\.\[\]#%!])/g, '\\$1');
}

const missing = [];
let checked = 0;
for (const cls of [...classes].sort()) {
  const looksTailwind = TAILWIND_PREFIXES.some((p) => cls === p || cls.startsWith(p))
    || /^(sm|md|lg|xl|2xl):/.test(cls);
  if (!looksTailwind) continue;
  checked += 1;
  const selector = '.' + escapeClass(cls);
  if (!css.includes(selector)) missing.push(cls);
}

console.log(`扫描到 ${classes.size} 个类名，其中疑似 Tailwind 工具类 ${checked} 个`);
if (missing.length === 0) {
  console.log('✓ 全部命中 static/css/tailwind.min.css');
} else {
  console.log('✗ 以下类未出现在 tailwind.min.css（可能是自定义类，需人工确认）:');
  for (const cls of missing) console.log('    ' + cls);
  process.exitCode = 1;
}
