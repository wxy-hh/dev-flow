# Dev Flow 复审问题修复设计

## 目标

修复复审发现的四个正确性问题，不改变已确认的非阻塞验收、通知触发时机或自主 Git 提交语义。

## 设计

实现批准的审批依据补入 `requirements`。登记需求文档的新哈希时，需求确认和确认执行都会失效，旧计划不能跨需求变更继续使用。

测试静默改为一个 Node 包装脚本：它递归收集指定目录的 `.test.mjs` 文件，再以 `DEV_FLOW_DISABLE_ATTENTION=1` 和 `NODE_ENV=test` 启动 Node 测试或 host E2E。`package.json` 只调用该包装器，因此 Windows 的 `cmd.exe` 不再解析 POSIX 形式的环境变量赋值。

交付快照在读出当前脏路径前重新解析 `HEAD`，并要求它严格等于 feature 启动时记录的 `deliveryBaseline.gitHead`。任何中途提交或历史改写都返回可操作错误，防止生成无法代表 feature 的补丁。

Windows `.lnk` 注册脚本将 `System.AppUserModel.PreventPinning` 写在 `System.AppUserModel.ID` 之前，满足 Windows 属性存储的顺序要求。

## 验收标准

- 更新需求文档后，已确认的实现批准与其交互记录均被撤销。
- Windows、macOS 与 CI 都能通过 `npm test`、各个公开测试子命令和 `npm run test:host-e2e`；测试期间不触发 OS 提醒。
- feature 启动后发生 Git HEAD 漂移时，finalize 拒绝且不写交付快照；HEAD 未变的既有快照路径保持可逆。
- Windows 注册脚本的 `PreventPinning` 写入先于 AUMID；其余 Toast 行为不变。
