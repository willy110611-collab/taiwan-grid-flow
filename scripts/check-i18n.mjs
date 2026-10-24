// 上線前檢查：每個 t('中文') 都要有英文（i18n.js 的 EN 字典），漏了就讓部署失敗
import fs from 'fs';
const src = fs.readFileSync('src/i18n.js', 'utf8');
const en = src.slice(src.indexOf('const EN = {'));
const keys = new Set([...en.matchAll(/'((?:[^'\\]|\\.)*)'\s*:/g)].map((m) => m[1]));
const miss = [];
for (const f of fs.readdirSync('src/components')) {
  const s = fs.readFileSync(`src/components/${f}`, 'utf8');
  for (const m of s.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)) {
    if (/[一-鿿]/.test(m[1]) && !keys.has(m[1])) miss.push(`${f}: ${m[1]}`);
  }
  for (const m of s.matchAll(/<Panel title="([^"]+)"/g)) if (!keys.has(m[1])) miss.push(`${f}: Panel ${m[1]}`);
}
if (miss.length) {
  console.error(`✗ 缺英文翻譯 ${miss.length} 項：\n` + [...new Set(miss)].join('\n'));
  process.exit(1);
}
console.log('✓ i18n：所有 t() 都有英文');
