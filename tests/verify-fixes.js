/* 修复验证：编码识别/转存、懒加载列表、全量兼容接口 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const fm = require('../main/fileManager');

const tmp = path.join(os.tmpdir(), 'markflow-verify');
fs.mkdirSync(tmp, { recursive: true });
const gbkFile = path.join(tmp, 'gbk-sample.md');
// “中文测试” 的 GBK 字节：D6D0 CEC4 B2E2 CAD4
fs.writeFileSync(gbkFile, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]));

const r1 = fm.readFile(gbkFile);
console.log('GBK 读取  =>', r1.content === '中文测试' && r1.encoding === 'gbk' ? 'PASS' : `FAIL (${r1.encoding})`, JSON.stringify(r1.content));

const w1 = fm.writeFileAtomic(gbkFile, '中文测试已转换', false, r1.encoding);
console.log('GBK 转存  =>', w1.converted === 'utf-8' ? 'PASS' : 'FAIL', '| converted =', w1.converted);

const r2 = fm.readFile(gbkFile);
console.log('转后回读  =>', r2.content === '中文测试已转换' && r2.encoding === 'utf-8' && r2.bom === true ? 'PASS' : 'FAIL', `(${r2.encoding}, bom=${r2.bom})`);

// UTF-8 严格校验：非法字节不应被当成 UTF-8
const bad = path.join(tmp, 'bad-utf8.md');
fs.writeFileSync(bad, Buffer.from([0x61, 0x62, 0xff, 0xfe, 0x63])); // 含 0xFF 非法 UTF-8
const r3 = fm.readFile(bad);
console.log('非法 UTF8 =>', r3.encoding !== 'utf-8' ? `PASS (识别为 ${r3.encoding})` : 'FAIL');

// UTF-16LE BOM
const u16 = path.join(tmp, 'utf16.md');
fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('宽字符测试', 'utf-16le')]));
const r4 = fm.readFile(u16);
console.log('UTF-16LE  =>', r4.content === '宽字符测试' && r4.encoding === 'utf-16le' && r4.bom ? 'PASS' : 'FAIL');

// 懒加载：只返回一层（指向含 md 的 samples 目录）
const sampleDir = path.join(__dirname, '..', 'samples');
const nodes = fm.listChildren(sampleDir, 'name');
console.log('懒加载列表=>', nodes.length > 0 && nodes.every((n) => n.children === null || n.children === undefined) ? 'PASS' : 'FAIL', `| ${nodes.length} 个节点`);

// 全量兼容接口
const tree = fm.listDir(sampleDir, 'name');
console.log('全量列表  =>', Array.isArray(tree) && tree.length > 0 ? 'PASS' : 'FAIL');

// 搜索限流字段
const s = fm.searchDir(sampleDir, 'markdown', { content: true, name: true });
console.log('目录搜索  =>', s.ok !== false && Array.isArray(s.files) && typeof s.total === 'number' && typeof s.truncated === 'boolean' ? 'PASS' : 'FAIL', `| files=${s.files.length} total=${s.total} truncated=${s.truncated}`);

try { fs.unlinkSync(gbkFile); fs.unlinkSync(bad); fs.unlinkSync(u16); } catch { /* noop */ }
console.log('--- verify done ---');
