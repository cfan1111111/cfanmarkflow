/**
 * MarkFlow - 会话持久化（userData/session.json），用于崩溃恢复与窗口状态续接（N5 / U4）。
 * 结构：{ tabs: [{ path, name, content, cursor, mode, dirty, bom }], activeIndex, workingDir, savedAt }
 */
const path = require('path');
const fs = require('fs');

class SessionStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'session.json');
  }

  get() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch {
      return null;
    }
  }

  save(data) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ ...data, savedAt: Date.now() }, null, 2), 'utf-8');
      fs.renameSync(tmp, this.file);
      return true;
    } catch (e) {
      console.error('[session] 保存失败:', e.message);
      return false;
    }
  }
}

module.exports = { SessionStore };
