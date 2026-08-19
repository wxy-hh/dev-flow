/**
 * Bash 门禁分析单测（node:test，零新增依赖——计划 §4 T4 判据）
 *
 * 覆盖：写入目标启发式解析用例集（`>`/`>>`/`tee`/`sed -i`/`cp`/`mv`/变量/
 * 引号边界/粘连/heredoc/多段命令）；解析不出=放行不拦（targets 为空）；
 * 不可逆操作模式表（git push / DROP / publish 家族 / rm -rf 高危）；
 * 宁漏勿滥（git status、rm -rf node_modules、--dry-run 不拦）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeBashCommand, lex, WRITE_HINT_RE, IRREVERSIBLE_HINT_RE } from '../src/lib/bash-gate.js'

/** 解析命令的写入目标（断言方便） */
function targets(cmd: string): string[] {
  return analyzeBashCommand(cmd).writeTargets
}

/** 断言不可逆命中规则 */
function irrev(cmd: string, rule: string | null): void {
  const r = analyzeBashCommand(cmd).irreversible
  assert.equal(r.matched, rule !== null, `命令不可逆判定：${cmd} → ${String(rule)}`)
  assert.equal(r.rule, rule)
}

test('重定向 `>`/`>>`：基本、粘连、追加', () => {
  assert.deepEqual(targets('echo x > .env'), ['.env'])
  assert.deepEqual(targets('echo x >> .env'), ['.env'])
  assert.deepEqual(targets('echo x >.env'), ['.env'])
  assert.deepEqual(targets('cat a>b'), ['b'])
  assert.deepEqual(targets('echo x > a b'), ['a'])
})

test('重定向引号边界：空格、引号、转义', () => {
  assert.deepEqual(targets('echo x > "a b".txt'), ['a b.txt'])
  assert.deepEqual(targets("echo x > 'x'.env"), ['x.env'])
  assert.deepEqual(targets('echo x > a\\ b.env'), ['a b.env'])
  assert.deepEqual(targets('echo "x > y" > out.txt'), ['out.txt'])
})

test('变量与命令替换：解析不出=不纳入目标（宁漏勿误拦）', () => {
  assert.deepEqual(targets('echo x > $VAR'), [])
  assert.deepEqual(targets('echo x > "$PWD/.env"'), [])
  assert.deepEqual(targets('echo x > ${HOME}/x'), [])
  assert.deepEqual(targets('echo x > $(echo .env)'), [])
  // 同一命令里可解析的目标仍检出（$VAR 作参数不影响其后重定向的字面目标）
  assert.deepEqual(targets('echo x > fixed.txt && cat $VAR > y'), ['fixed.txt', 'y'])
})

test('tee：全部参数为写入目标（-a 选项、- 输出 stdout）', () => {
  assert.deepEqual(targets('echo x | tee .env'), ['.env'])
  assert.deepEqual(targets('echo x | tee a b'), ['a', 'b'])
  assert.deepEqual(targets('echo x | tee -a .env out2'), ['.env', 'out2'])
  assert.deepEqual(targets('echo x | tee -'), [])
})

test('sed -i：脚本与文件边界（GNU/BSD/后缀/-e 组合）', () => {
  assert.deepEqual(targets("sed -i 's/x/y/' file"), ['file'])
  assert.deepEqual(targets("sed -i 's/x/y/' .env"), ['.env'])
  assert.deepEqual(targets("sed -i.bak 's/x/y/' file"), ['file'])
  assert.deepEqual(targets("sed -i '' 's/x/y/' file"), ['file'])
  assert.deepEqual(targets("sed -i -e 's/x/y/' file"), ['file'])
  assert.deepEqual(targets("sed -i -e 's/x/y/' -e 'd' file"), ['file'])
  assert.deepEqual(targets("sed -i -E 's/x/y/' file"), ['file'])
  // 无 -i：sed 只是读，不算写入
  assert.deepEqual(targets("sed 's/x/y/' file > out"), ['out'])
  // BSD 单独后缀（罕见）：最后一个非选项参数恒为文件
  assert.deepEqual(targets("sed -i .bak 's/x/y/' file"), ['file'])
})

test('cp/mv：最后一个参数为目标（选项/多源）', () => {
  assert.deepEqual(targets('cp a b'), ['b'])
  assert.deepEqual(targets('cp -r a b'), ['b'])
  assert.deepEqual(targets('cp a b c'), ['c'])
  assert.deepEqual(targets('mv a b'), ['b'])
  assert.deepEqual(targets('mv -f a b'), ['b'])
  assert.deepEqual(targets('cp .env /tmp/'), ['/tmp/'])
})

test('多段命令：&& / 管道 / 分号各自解析', () => {
  assert.deepEqual(targets('echo x > .env && echo y > b'), ['.env', 'b'])
  assert.deepEqual(targets('cat a > out | tee log'), ['out', 'log'])
  assert.deepEqual(targets('true; echo z > c'), ['c'])
  assert.deepEqual(targets('cd /tmp && echo x > f'), ['f'])
})

test('heredoc：body 里的 `>` 不被误读为重定向（防误拦）', () => {
  const cmd = 'cat <<EOF > out.txt\necho x > .env\nEOF\n'
  assert.deepEqual(targets(cmd), ['out.txt'])
  // 带引号分隔符
  const cmd2 = "cat <<'EOF' > out.txt\ntee .env <<X\nX\nEOF\n"
  assert.deepEqual(targets(cmd2), ['out.txt'])
})

test('解释器写入（残余风险）与纯读命令：无解析目标 → 放行', () => {
  assert.deepEqual(targets("python -c \"open('.env','w')\""), [])
  assert.deepEqual(targets('ls -la'), [])
  assert.deepEqual(targets('git status'), [])
  assert.deepEqual(targets('cat README.md'), [])
  assert.deepEqual(targets('npm test'), [])
})

test('lex：引号内特殊字符不被切分/展开', () => {
  const segs = lex("echo 'a | b' > out")
  assert.equal(segs.length, 1, '单引号内的 | 不应切段')
  const tokens = segs[0].map((t) => (t.redir !== null ? t.redir : t.text))
  assert.deepEqual(tokens, ['echo', 'a | b', '>', 'out'])
  // 双引号内 $ 标记 dynamic
  const segs2 = lex('echo "$HOME"')
  assert.equal(segs2[0][1].dynamic, true)
  // 单引号内 $ 是字面，不标记 dynamic
  const segs3 = lex("echo '$HOME'")
  assert.equal(segs3[0][1].dynamic, false)
  assert.equal(segs3[0][1].text, '$HOME')
})

// —— 不可逆操作模式表 ——

test('git push 一律拦（含 -f/origin），其他 git 子命令不拦', () => {
  irrev('git push', 'irreversible.push')
  irrev('git push origin main', 'irreversible.push')
  irrev('git push -f', 'irreversible.push')
  irrev('git push --force-with-lease origin main', 'irreversible.push')
  irrev('git status', null)
  irrev('git commit -m x', null)
  irrev('git add .', null)
  irrev('git log', null)
})

test('删表类：SQL 客户端下的 DROP 才拦（防 grep 误拦）', () => {
  irrev('psql -c "DROP TABLE users"', 'irreversible.drop')
  irrev('mysql -e "drop database app"', 'irreversible.drop')
  irrev("sqlite3 db.sqlite 'DROP TABLE IF EXISTS t'", 'irreversible.drop')
  irrev("grep -r 'DROP TABLE' src", null)
  irrev('echo DROP TABLE', null)
  irrev('SELECT * FROM users', null)
})

test('发版：publish 家族拦，--dry-run 放行', () => {
  irrev('npm publish', 'irreversible.publish')
  irrev('pnpm publish', 'irreversible.publish')
  irrev('yarn publish', 'irreversible.publish')
  irrev('npx publish', 'irreversible.publish')
  irrev('npm run publish', 'irreversible.publish')
  irrev('npm publish --dry-run', null)
  irrev('npm run build', null)
  irrev('npm install', null)
})

test('rm -rf 高危目标拦（系统根/家目录本体/凭据/当前目录），常规清理放行', () => {
  irrev('rm -rf /', 'irreversible.rm')
  irrev('rm -rf /etc', 'irreversible.rm')
  irrev('rm -rf /etc/ssl', 'irreversible.rm')
  irrev('rm -rf /usr/local', 'irreversible.rm')
  irrev('rm -rf ~', 'irreversible.rm')
  irrev('rm -rf $HOME', 'irreversible.rm')
  irrev('rm -rf ~/.ssh', 'irreversible.rm')
  irrev('rm -rf .', 'irreversible.rm')
  irrev('rm -rf ..', 'irreversible.rm')
  irrev('rm -rf /Users/weixiaoyu', 'irreversible.rm')
  irrev('sudo rm -rf /', 'irreversible.rm')
  irrev('rm -rf node_modules', null)
  irrev('rm -rf build/', null)
  irrev('rm -rf ./node_modules', null)
  irrev('rm -f x', null)
  irrev('rm -r x', null)
  irrev('rm x', null)
  irrev('rm -rf /Users/weixiaoyu/code/x/node_modules', null)
})

test('快筛正则：无命中命令（性能抽测前置）', () => {
  assert.equal(IRREVERSIBLE_HINT_RE.test('ls -la'), false)
  assert.equal(WRITE_HINT_RE.test('ls -la'), false)
  assert.equal(IRREVERSIBLE_HINT_RE.test('git status'), false)
  assert.equal(WRITE_HINT_RE.test('npm test'), false)
  // 命中进完整路径
  assert.equal(IRREVERSIBLE_HINT_RE.test('git push'), true)
  assert.equal(WRITE_HINT_RE.test('echo x > y'), true)
  assert.equal(WRITE_HINT_RE.test('npm run cp'), true) // cp 词命中（进完整解析后无目标 → 放行）
})
