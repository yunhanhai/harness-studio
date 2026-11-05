import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const HELP = `Compare Studio skill metadata with the installed DSH filesystem provider.

Usage:
  node scripts/test-skills-native-parser.mjs --dsh-package <package-directory> [options]

Options:
  --dsh-package <path>     Required root of an installed @deepseek-ai/dsh package.
  --expect-version <v>     Fail if the DSH or provider version differs from v.
  --report <path>          Also write the JSON result to this path.
  --help                  Show this help without loading DSH.

Reads program packages only. Skills are copied to a new temporary directory;
default roots and watchers are disabled. No Host, account, user profile,
credential store, model endpoint, or tool execution is involved.
`

async function main() {
  const { values } = parseArgs({ options: {
    'dsh-package': { type: 'string' },
    'expect-version': { type: 'string' },
    report: { type: 'string' },
    help: { type: 'boolean' }
  } })
  if (values.help) { process.stdout.write(HELP); return }
  if (!values['dsh-package']?.trim()) throw new Error('--dsh-package is required. Use --help for usage.')

  const installation = resolve(values['dsh-package'])
  const reportPath = values.report ? resolve(values.report) : undefined
  const report = {
    passed: false,
    checkedAt: new Date().toISOString(),
    dshPackage: installation,
    expectedVersion: values['expect-version'] ?? null,
    upstreamVersion: null,
    providerVersion: null,
    presetVersion: null,
    nativeParserComparisons: 0,
    candidateCount: 0,
    bundledSkillCount: 0,
    fixtureCount: 5,
    checks: [],
    warningCount: 0,
    temporaryDirectoryRemoved: false,
    scope: 'Installed program bundle instructions copied to a fresh temporary root; native filesystem provider only. No Host, user profiles, accounts, model credentials, model requests or tool execution.'
  }
  let temporaryRoot
  let provider
  let failure
  const abort = new AbortController()
  try {
    const packageFile = join(installation, 'package.json')
    const dsh = JSON.parse(await readFile(packageFile, 'utf8'))
    assert.equal(dsh.name, '@deepseek-ai/dsh', '--dsh-package must point to the DSH program package, not DSH_HOME')
    report.upstreamVersion = dsh.version
    const requireFromDsh = createRequire(packageFile)
    const providerPackage = JSON.parse(await readFile(requireFromDsh.resolve('@deepseek-ai/dsh-skill-filesystem/package.json'), 'utf8'))
    const presetFile = requireFromDsh.resolve('@deepseek-ai/dsh-agent-preset/package.json')
    const presetPackage = JSON.parse(await readFile(presetFile, 'utf8'))
    report.providerVersion = providerPackage.version
    report.presetVersion = presetPackage.version
    if (values['expect-version']) {
      for (const [name, version] of [['DSH', dsh.version], ['filesystem provider', providerPackage.version], ['agent preset', presetPackage.version]]) {
        assert.equal(version, values['expect-version'], `${name} does not match --expect-version`)
      }
    }

    temporaryRoot = await mkdtemp(join(tmpdir(), 'harness-native-skill-parser-'))
    const fixtures = join(temporaryRoot, 'fixtures')
    await mkdir(fixtures)
    const { parseSkillContent } = createTypeScriptLoader()(new URL('../src/main/skills.ts', import.meta.url))
    const bodies = new Map()
    const bundledRoot = join(dirname(presetFile), 'skills')
    for (const entry of (await readdir(bundledRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      let content
      try { content = await readFile(join(bundledRoot, entry.name, 'SKILL.md'), 'utf8') }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const parsed = parseSkillContent(content)
      assert.ok(!bodies.has(parsed.name), `Duplicate bundled skill name: ${parsed.name}`)
      const folder = join(fixtures, parsed.name)
      assert.equal(dirname(folder), fixtures, 'Parsed skill name must stay inside the fixture directory')
      await mkdir(folder)
      await writeFile(join(folder, 'SKILL.md'), content, { flag: 'wx' })
      bodies.set(parsed.name, { parsed, origin: 'bundled' })
    }
    report.bundledSkillCount = bodies.size
    assert.ok(report.bundledSkillCount > 0, 'The selected DSH package contains no bundled skill instructions to compare')

    // Keep the original five probes: three accepted metadata variants and two
    // rejected declarations, plus every bundled SKILL.md (four in rc.2).
    const cases = [
      ['boolean-yes', 'disable-model-invocation: "YES"\nuser-invocable: "0"'],
      ['block-description', 'description: >-\n  Folded words\n  across lines.\nuser-invocable: on'],
      ['boolean-false', 'disable-model-invocation: false\nuser-invocable: "off"'],
      ['invalid-boolean', 'user-invocable: sometimes'],
      ['legacy', 'modelInvocable: false']
    ]
    for (const [name, extra] of cases) {
      assert.ok(!bodies.has(name), `Bundled skill conflicts with parser fixture: ${name}`)
      const description = name === 'block-description' ? '' : 'description: parser comparison\n'
      const content = `---\nname: ${name}\n${description}${extra}\n---\nBody\n`
      await writeFile(join(fixtures, `${name}.md`), content, { flag: 'wx' })
      let parsed
      try { parsed = parseSkillContent(content) } catch { /* Native provider must reject it too. */ }
      bodies.set(name, { parsed, origin: 'fixture' })
    }

    const { FileSystemSkillProvider } = await import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/dsh-skill-filesystem')).href)
    assert.equal(typeof FileSystemSkillProvider, 'function', 'The selected DSH provider does not expose FileSystemSkillProvider')
    provider = new FileSystemSkillProvider(
      { get: () => undefined, logger: { warn: () => { report.warningCount++ } } },
      { signal: abort.signal, invalidate: () => {} },
      {
        includeDefaultRoots: false,
        customSkillDirs: [fixtures],
        dshHome: join(temporaryRoot, 'dsh'),
        agentsHome: join(temporaryRoot, 'agents'),
        bundledSkillDir: join(temporaryRoot, 'no-bundled-root'),
        watch: false
      }
    )
    const observation = await provider.list({ cwd: fixtures, signal: abort.signal })
    const candidates = Array.isArray(observation) ? observation : observation?.candidates
    assert.ok(Array.isArray(candidates), 'The selected DSH provider returned an unsupported catalog format')
    report.candidateCount = candidates.length
    for (const [name, value] of bodies) {
      const matches = candidates.filter(candidate => candidate.name === name)
      const check = { name, origin: value.origin, accepted: Boolean(value.parsed), passed: false }
      report.checks.push(check)
      if (!value.parsed) assert.equal(matches.length, 0, `${name} must be rejected by the native provider`)
      else {
        assert.equal(matches.length, 1, `${name} must be recognized exactly once by the native provider`)
        const [actual] = matches
        assert.equal(actual.description, value.parsed.description, `${name}: description`)
        assert.equal(actual.invocation?.modelInvocable, value.parsed.modelInvocable, `${name}: model invocation`)
        assert.equal(actual.invocation?.userInvocable, value.parsed.userInvocable, `${name}: user invocation`)
      }
      check.passed = true
      report.nativeParserComparisons++
    }
    assert.equal(candidates.length, [...bodies.values()].filter(value => value.parsed).length, 'Native provider returned skills outside the isolated fixtures')
    report.passed = true
  } catch (error) {
    failure = error
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    abort.abort()
    try { await provider?.dispose() }
    catch (error) {
      failure ??= error
      report.passed = false
      report.cleanupError = error instanceof Error ? error.message : String(error)
    }
    if (temporaryRoot) {
      try {
        const part = relative(resolve(tmpdir()), resolve(temporaryRoot))
        assert.ok(part.startsWith('harness-native-skill-parser-') && !part.includes(sep) && !isAbsolute(part), 'Refuse to clean an unexpected temporary path')
        await rm(temporaryRoot, { recursive: true, force: true })
        report.temporaryDirectoryRemoved = true
      } catch (error) {
        failure ??= error
        report.passed = false
        report.cleanupError = error instanceof Error ? error.message : String(error)
      }
    }
  }
  const output = `${JSON.stringify(report, null, 2)}\n`
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, output, 'utf8')
  }
  process.stdout.write(output)
  if (failure) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
