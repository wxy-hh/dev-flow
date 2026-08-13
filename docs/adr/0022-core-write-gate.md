# 写门禁收在 Core，必要时自己 begin 单元

宿主 PreTool 既在判断写入，又在第一次 governed 写时推进实现单元；`judgeWrite` 是为可测性抽出的浅函数，阶段、批准、单元、归属、git 仍在 adapter-policy 里各判一次。

**决定：** 一个 Core 写门禁，不自己发明 inspect/preview。形状为：

```ts
writeGate(root, intent): Promise<allow | audit | block>

intent =
  | { kind: "file"; paths }
  | { kind: "git"; paths }
  | { kind: "git"; form: "unbounded" | "publish" }
```

文件允许路径上该 begin 时由门禁自己 begin。git 不 begin。`audit` 只用于启动排除 ∩ 预存脏：提示不拦。host adapter 解析句法、调用一次、格式化拦截。bash/git 句法留在 adapter。归属与 git 问这一处，读当前 ownership；启动零提问不在这刀改。公开 `judgeWrite` 删除。危险操作授权仍独立。

**为什么：** 只判断不推进会退回「批准后第一笔普通写入失败」。懒 begin 留在 adapter 则分层继续破。文件写和 git 分两张表，归属一变又对不齐。公开 inspect 会让 caller 再编排「先看再决定调不调 evaluate」。空 `paths` 不能同时表示 `add -A` 和「暂存区为空」，所以 git 要单独的 `form`。

**后果：** 测试打 `writeGate` 结果，不打 tee/sed 正则；要避免 begin 就用已有 active 单元的夹具。claude/codex adapter 保持薄。控制区、intake 禁写、logic-complete 前拒 git 写的规则不降。
