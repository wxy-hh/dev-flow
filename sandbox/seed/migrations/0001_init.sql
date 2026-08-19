-- 假迁移脚本（sandbox 种子）：敏感路径样本——数据类
-- 仅占位，T4 敏感路径拦截的测试目标物，不用于真实数据库。
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
