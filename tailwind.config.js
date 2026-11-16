/** @type {import('tailwindcss').Config} */
// 说明：原先页面通过 <script src="https://cdn.tailwindcss.com"></script>
// 在浏览器里实时编译 Tailwind（需要外网）。现在改为本地预编译：
//   npm run build:css  ->  static/css/tailwind.min.css
// 这里只扫描真正用到 Tailwind 工具类的模板/脚本，插件与默认主题与 CDN 版保持默认一致。
module.exports = {
  content: [
    './templates/2d_main.html',
    './templates/3d_main.html',
    './static/js/2d_main.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
};
