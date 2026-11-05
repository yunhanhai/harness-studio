// Execute the workflow's actual shell against temporary local Git repositories.
// The Gitee URL is rewritten to a file URL; no credentials or network are used.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/mirror-gitee.yml'), 'utf8'))
const job = workflow.jobs['sync-main']
assert.equal(job.steps[0].with.ref, 'main')
assert.equal(job.steps[0].with['persist-credentials'], false)
const script = job.steps.find(step => step.run)?.run
assert.ok(script)

let bash = 'bash'
if (process.platform === 'win32') {
  const gitPath = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8', windowsHide: true }).stdout?.trim().split(/\r?\n/)[0]
  const candidates = gitPath ? [join(dirname(gitPath), '..', 'bin', 'bash.exe'), join(dirname(gitPath), 'bash.exe')] : []
  bash = candidates.find(existsSync)
  assert.ok(bash, 'Git for Windows bash.exe is required to test the Linux workflow shell')
}

const scratch = mkdtempSync(join(tmpdir(), 'studio-gitee-sync-'))
const config = join(scratch, 'gitconfig')
writeFileSync(config, '')
const cleanEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' }
function run(command, args, cwd, env = cleanEnv, input) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (result.error) throw result.error
  return result
}
function git(cwd, args, input) {
  const result = run('git', args, cwd, cleanEnv, input)
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}
function refs(remote) {
  return new Map(git(remote, ['for-each-ref', '--format=%(refname) %(objectname)']).split('\n').filter(Boolean).map(line => line.split(' ')))
}

try {
  const scriptPath = join(scratch, 'sync.sh')
  writeFileSync(scriptPath, script)
  for (const scenario of ['equal-diverged', 'fast-forward', 'different-diverged', 'missing-main']) {
    const folder = join(scratch, scenario)
    const source = join(folder, 'source')
    const remote = join(folder, 'remote.git')
    mkdirSync(source, { recursive: true })
    git(source, ['init', '-b', 'main'])
    git(source, ['config', 'user.name', 'Fixture'])
    git(source, ['config', 'user.email', 'fixture@example.invalid'])
    // Ensure an ambient preference cannot cause implicit tag publication.
    git(source, ['config', 'push.followTags', 'true'])
    writeFileSync(join(source, 'content.txt'), 'baseline\n')
    git(source, ['add', '.'])
    git(source, ['commit', '-m', 'baseline'])
    const base = git(source, ['rev-parse', 'HEAD'])
    const tree = git(source, ['rev-parse', 'HEAD^{tree}'])
    const target = scenario.includes('diverged') ? git(source, ['commit-tree', tree], 'independent target history\n') : base
    git(folder, ['init', '--bare', '-b', 'main', remote])
    git(source, ['tag', '-a', 'v0.0.1', target, '-m', 'Existing remote release'])
    git(source, ['push', '--no-follow-tags', remote, 'refs/tags/v0.0.1:refs/tags/v0.0.1', `${target}:refs/heads/target-only`, ...(scenario === 'missing-main' ? [] : [`${target}:refs/heads/main`])])
    if (scenario === 'fast-forward' || scenario === 'different-diverged') {
      writeFileSync(join(source, 'content.txt'), 'new source content\n')
      git(source, ['add', '.'])
      git(source, ['commit', '-m', 'new source'])
    }
    git(source, ['tag', '-f', '-a', 'v0.0.1', '-m', 'Different local release'])
    git(source, ['tag', '-a', 'local-only', '-m', 'Must stay local'])
    const sourceHead = git(source, ['rev-parse', 'HEAD'])
    const sourceTags = git(source, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/tags'])
    const before = refs(remote)
    const result = run(bash, [scriptPath.replaceAll('\\', '/')], source, {
      ...cleanEnv,
      RUNNER_TEMP: scratch.replaceAll('\\', '/'),
      GITEE_USERNAME: 'local-fixture', GITEE_TOKEN: 'fixture-placeholder',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(remote).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://gitee.com/local-fixture/harness-studio.git'
    })
    const shouldPass = scenario === 'equal-diverged' || scenario === 'fast-forward'
    assert.equal(result.status === 0, shouldPass, `${scenario}: ${result.stdout}\n${result.stderr}`)
    const after = refs(remote)
    if (scenario === 'fast-forward') before.set('refs/heads/main', sourceHead)
    assert.deepEqual(after, before, `${scenario}: unexpected branch/tag change`)
    assert.equal(git(source, ['rev-parse', 'HEAD']), sourceHead)
    assert.equal(git(source, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/tags']), sourceTags)
    console.log(`PASS ${scenario}: expected main behavior; all other refs preserved`)
  }
  console.log('Passed 4 Gitee main sync workflow scenarios (local repositories only).')
} finally {
  const part = relative(resolve(tmpdir()), resolve(scratch))
  assert.ok(part.startsWith('studio-gitee-sync-') && !part.includes(sep) && !isAbsolute(part), 'Refuse to clean an unexpected temporary path')
  rmSync(scratch, { recursive: true, force: true })
}
