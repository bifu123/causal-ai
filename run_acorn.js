const fs = require('fs');
try {
  const acorn = require('acorn');
  const content = fs.readFileSync('/home/test/causal_ai/static/js/3d_main.js', 'utf8');
  acorn.parse(content, { ecmaVersion: 2020 });
  console.log("No syntax errors");
} catch (e) {
  console.log("Error:", e.message);
  console.log("Location:", e.loc);
  
  if (e.loc) {
    const lines = fs.readFileSync('/home/test/causal_ai/static/js/3d_main.js', 'utf8').split('\n');
    const start = Math.max(0, e.loc.line - 5);
    const end = Math.min(lines.length, e.loc.line + 5);
    for (let i = start; i < end; i++) {
        console.log(`${i+1}: ${lines[i]}`);
    }
  }
}
