# 奇门遁甲 Skill：秒出盘，直接断

这是一个面向 Claude Code 的时家转盘奇门工具：用 Python 做确定性排盘（九宫格 + JSON），Claude 负责高质量断局（用神/格局/生克/建议）。

- 排盘：`qimen_paipan.py` 秒级输出，避免“靠查表/靠推算”的漂移
- 断局：按用神 → 格局 → 门星神 → 生克 → 结论的结构化流程落地到你的具体问题

## 30 秒上手

1) 先起盘（不带参数默认用当前时间）：

```bash
python3 qimen_paipan.py
```

2) 或指定时间（24 小时制）：

```bash
python3 qimen_paipan.py 2026 4 11 15
```

3) 把输出里的九宫格盘面原样贴给 Claude，再补一句“我想问什么”（可选加出生年份做年命落宫）。

## 你会得到什么

脚本输出两段内容：

- 格式化九宫格盘面：适合直接给人看
- JSON 数据（夹在 `===JSON_START===` 和 `===JSON_END===` 之间）：适合给模型做严谨断局

盘面顶部会给出关键信息（四柱/阴阳遁几局/值符值使/空亡等），九宫格里每宫包含：八神、九星、八门、天盘干/地盘干、方位标记与空亡提示。

## Claude Code 用法（Skill）

当你在 Claude Code 里提到这些关键词时应触发该 Skill：

`奇门遁甲` `奇门` `遁甲` `排奇门` `起奇门局` `奇门排盘` `奇门预测` `时家奇门` `qimen` `qimendunjia`

推荐提问模板（一次说清）：

- 我想问：{具体事项}
- 起局时间：{YYYY-M-D H}（不填就用当前时间）
- 出生年份（可选）：{YYYY}

如果你是手动使用脚本：把脚本输出的九宫格盘面贴到对话里即可（JSON 段可贴可不贴，贴了更利于严谨分析）。

## 安装

### 依赖

- Python 3（脚本无第三方依赖）

### 放到 Claude Code 的 skills 目录

```bash
git clone <repo_url> ~/.claude/skills/qimen
```

如果你想项目级安装：

```bash
mkdir -p .claude/skills
git clone <repo_url> .claude/skills/qimen
```

## 断局速查入口

- 用神/吉凶/五步法速查：[duanju-quick.md](./duanju-quick.md)
- 更完整的格局与象意表：[duanju-guide.md](./duanju-guide.md)
- 常用对照表（天干/地支/五行等）：[lookup-tables.md](./lookup-tables.md)
- 地盘相关速查：[dipan-lookup.md](./dipan-lookup.md)
- 节气速查：[jieqi-lookup.md](./jieqi-lookup.md)

## 文件结构

```
qimen.skill/
├── README.md
├── SKILL.md
├── qimen_paipan.py
├── duanju-quick.md
├── duanju-guide.md
├── lookup-tables.md
├── dipan-lookup.md
└── jieqi-lookup.md
```

## 与 v1/v2 的差异

| | v1/v2 | v3 |
|---|---|---|
| 排盘方式 | 模型查表/推算 | 脚本确定性计算 |
| 排盘速度 | 分钟级 | 秒级 |
| 可复现性 | 易漂移 | 同输入同输出 |
| 模型职责 | 排盘+断局 | 聚焦断局 |

## 常见问题

### 时间怎么填？

- `python3 qimen_paipan.py 2026 4 11 15` 中的 `15` 是 24 小时制小时（0–23）
- 不带参数默认用本机当前时间（注意时区）

### 节气会不会有误差？

脚本使用近似算法计算节气，注释标明误差约 1 天。遇到临界节气（交节附近）建议你手动确认起局时间所在节气，或把你确认的节气信息补充给 Claude 以便解释更稳。

### Skill 报找不到脚本路径？

如果运行时报 `scripts/qimen_paipan.py` 或 `references/...` 找不到，说明你的 Skill 配置路径与当前仓库文件结构不一致。以本仓库实际路径为准：脚本入口是 `qimen_paipan.py`，参考资料在仓库根目录的各个 `*.md` 文件。

## 声明

奇门遁甲属于传统文化内容，本工具仅供学习研究与娱乐参考。重大决策请综合现实信息审慎判断。

## License

MIT
