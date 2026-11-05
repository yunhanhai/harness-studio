import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const taskRoot = await fs.mkdtemp(join(tmpdir(), 'harness-skills-test-'))
const load = createTypeScriptLoader()
const { SkillsService, parseSkillContent, readSkillConfiguration } = load(new URL('../src/main/skills.ts', import.meta.url))
const service = new SkillsService(join(taskRoot, 'backups'))
const context = {
  cwd: join(taskRoot, 'repo', 'nested', 'cwd'),
  dshHome: join(taskRoot, 'dsh'), home: join(taskRoot, 'user'), profile: 'qa',
  agentsHome: join(taskRoot, 'agents'), processCwd: join(taskRoot, 'launch'),
  cliPath: join(taskRoot, 'runtime', 'lib', 'bin.js'), allowUnverifiedDefaults: true
}
const text = (name, body = 'Instructions.', extra = '') => `---\nname: ${name}\ndescription: A test skill\n${extra}---\n${body}\n`
let passed = 0
async function check(name, run) { await run(); passed++; process.stdout.write(`ok ${passed} - ${name}\n`) }
async function source(kind, selectedContext = context) { return (await service.list(selectedContext)).sources.find(item => item.kind === kind) }
async function item(name, selectedContext = context) { return (await service.list(selectedContext)).skills.find(value => value.name === name && !value.shadowedBy) }
async function writeBundle(root, name, content = text(name)) {
  const directory = join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(join(directory, 'SKILL.md'), content)
  return directory
}

function withBackupMetadataFailure(backupRoot) {
  let fail = false
  let failures = 0
  const controlledLoader = createTypeScriptLoader({ 'node:fs/promises': {
    ...fs,
    writeFile: async (path, content, options) => {
      if (fail && path.endsWith(`${sep}record.json`) && options?.flag === 'wx') {
        failures++
        throw new Error('Injected backup metadata failure')
      }
      return fs.writeFile(path, content, options)
    }
  } })
  const ControlledService = controlledLoader(new URL('../src/main/skills.ts', import.meta.url)).SkillsService
  return {
    service: new ControlledService(backupRoot),
    arm: () => { fail = true }, disarm: () => { fail = false }, failures: () => failures
  }
}

function withRecordUpdateFailure(backupRoot, shouldFail) {
  let failures = 0
  const controlledLoader = createTypeScriptLoader({ 'node:fs/promises': {
    ...fs,
    rename: async (from, to) => {
      if (to.endsWith(`${sep}record.json`) && shouldFail(JSON.parse(await fs.readFile(from, 'utf8')))) {
        failures++
        throw new Error('Injected backup record update failure')
      }
      return fs.rename(from, to)
    }
  } })
  const ControlledService = controlledLoader(new URL('../src/main/skills.ts', import.meta.url)).SkillsService
  return { service: new ControlledService(backupRoot), failures: () => failures }
}

try {
  await fs.mkdir(context.cwd, { recursive: true })
  await fs.mkdir(join(taskRoot, 'repo', '.git'))
  await check('nearest Git root, rank order, unverified disk inventory and DSH-only write scopes', async () => {
    const inventory = await service.list(context)
    assert.equal(inventory.projectRoot, join(taskRoot, 'repo'))
    assert.deepEqual(inventory.sources.map(value => value.rank), [100, 200, 400, 500])
    assert.equal(inventory.configurationVerified, false)
    assert.equal(inventory.catalogKind, 'filesystem')
    assert.deepEqual(inventory.sources.filter(value => value.writable).map(value => value.kind), ['project-dsh', 'user-dsh'])
    assert.ok(!inventory.sources.some(value => /[\\/](?:\.codex|\.claude)[\\/]/.test(value.path)))
    assert.ok(inventory.warnings.some(value => /live invocation/.test(value)))
  })
  await check('CORE YAML block descriptions, strict rc.2 boolean policy and invalid keys', async () => {
    const metadata = parseSkillContent('---\nname: valid-name\ndescription: >-\n  A folded\n  description.\ndisable-model-invocation: "yes"\nuser-invocable: 0\nmetadata: {author: qa}\n---\n# Body\n')
    assert.equal(metadata.description, 'A folded description.')
    assert.equal(metadata.modelInvocable, false)
    assert.equal(metadata.userInvocable, false)
    assert.throws(() => parseSkillContent(text('Bad_Name')), /lowercase/)
    assert.throws(() => parseSkillContent(text('legacy', '', 'modelInvocable: false\n')), /Unsupported/)
    assert.throws(() => parseSkillContent(text('bad-boolean', '', 'user-invocable: maybe\n')), /boolean/)
    assert.throws(() => parseSkillContent('name: no-frontmatter'), /frontmatter/)
    assert.throws(() => parseSkillContent(text('duplicate', '', 'name: another\n')), /duplicated mapping/)
  })
  await check('scan directory and flat skills; report invalid declarations and winning local files', async () => {
    const project = await source('project-dsh')
    const user = await source('user-dsh')
    await writeBundle(project.path, 'same', text('same', 'Project wins'))
    await writeBundle(user.path, 'same', text('same', 'User fallback'))
    await fs.writeFile(join(project.path, 'flat.md'), text('flat'))
    await writeBundle(project.path, 'broken', '# No frontmatter')
    await writeBundle(join(project.path, 'container'), 'nested-only', text('nested-only'))
    const inventory = await service.list(context)
    const same = inventory.skills.filter(value => value.name === 'same')
    assert.equal(same.length, 2)
    assert.equal(same[0].shadowedBy, undefined)
    assert.equal(same[1].shadowedBy, same[0].id)
    assert.equal(inventory.skills.find(value => value.name === 'flat').format, 'file')
    assert.equal(inventory.skills.find(value => value.name === 'broken').valid, false)
    assert.equal(inventory.skills.find(value => value.name === 'nested-only'), undefined)
  })
  await check('create in a selected standard root, preview, and reject name/path collisions', async () => {
    const project = await source('project-dsh')
    const created = await service.create(context, project.id, 'new-skill', text('new-skill', 'Original'))
    assert.equal(created.skill.valid, true)
    assert.equal((await service.preview(context, created.skill.id)).content, text('new-skill', 'Original'))
    await assert.rejects(service.create(context, project.id, '../escape', text('escape')), /skill name/)
    await assert.rejects(service.create(context, project.id, 'con', text('con')), /reserved/)
    await assert.rejects(service.create(context, project.id, 'new-skill', text('new-skill')), /already exists/)
    await assert.rejects(service.create(context, project.id, 'different', text('actual')), /must match/)
    await assert.rejects(service.preview(context, '../escape'), /no longer belongs/)
  })
  await check('bundle import retains scripts, binary assets, references and empty directories', async () => {
    const incoming = await writeBundle(join(taskRoot, 'incoming'), 'resources')
    await fs.mkdir(join(incoming, 'scripts'))
    await fs.mkdir(join(incoming, 'assets'))
    await fs.mkdir(join(incoming, 'references', 'empty'), { recursive: true })
    await fs.writeFile(join(incoming, 'scripts', 'run.py'), 'print("resource kept")\n')
    await fs.writeFile(join(incoming, 'assets', 'binary.dat'), Buffer.from([0, 1, 255, 0, 42]))
    const project = await source('project-dsh')
    const imported = await service.import(context, project.id, incoming)
    assert.deepEqual(await fs.readFile(join(imported.skill.directory, 'assets', 'binary.dat')), Buffer.from([0, 1, 255, 0, 42]))
    assert.equal((await fs.stat(join(imported.skill.directory, 'references', 'empty'))).isDirectory(), true)
    assert.equal(imported.skill.resourceCount, 3)
    assert.equal(await fs.readFile(join(incoming, 'scripts', 'run.py'), 'utf8'), 'print("resource kept")\n')
    await assert.rejects(service.import(context, project.id, incoming), /already exists/)
  })
  await check('import a single SKILL.md into a bundle without importing unrelated sibling files', async () => {
    const incoming = join(taskRoot, 'single.md')
    await fs.writeFile(incoming, text('single-file'))
    const imported = await service.import(context, (await source('user-dsh')).id, incoming)
    assert.equal(imported.skill.format, 'bundle')
    assert.deepEqual((await service.preview(context, imported.skill.id)).resources, ['SKILL.md'])
  })
  await check('saving a bundle creates a restorable backup and preserves every resource', async () => {
    const skill = await item('resources')
    const before = await fs.readFile(join(skill.directory, 'assets', 'binary.dat'))
    const saved = await service.save(context, skill.id, skill.revision, text('resources', 'Edited'))
    assert.equal((await service.preview(context, skill.id)).content, text('resources', 'Edited'))
    assert.deepEqual(await fs.readFile(join(skill.directory, 'assets', 'binary.dat')), before)
    assert.ok(saved.backup.id)
    const restored = await service.restore(context, saved.backup.id)
    assert.equal((await service.preview(context, restored.skill.id)).content, text('resources'))
    const inverse = (await service.backups(context)).find(value => value.id !== saved.backup.id && value.operation === 'edit' && !value.restored)
    assert.ok(inverse)
    await service.restore(context, inverse.id)
    assert.equal((await service.preview(context, skill.id)).content, text('resources', 'Edited'))
  })
  await check('saving a flat skill preserves format and supports edit undo', async () => {
    const skill = await item('flat')
    const saved = await service.save(context, skill.id, skill.revision, text('flat', 'Flat edited'))
    assert.equal(saved.skill.format, 'file')
    await service.restore(context, saved.backup.id)
    assert.equal(await fs.readFile(skill.path, 'utf8'), text('flat'))
  })
  await check('stale revisions reject editing and deletion; resource changes also invalidate revision', async () => {
    const stale = await item('resources')
    await fs.writeFile(join(stale.directory, 'scripts', 'run.py'), 'external change\n')
    await assert.rejects(service.save(context, stale.id, stale.revision, text('resources', 'Lost change')), /changed on disk/)
    await assert.rejects(service.remove(context, stale.id, stale.revision), /changed on disk/)
    assert.equal(await fs.readFile(join(stale.directory, 'scripts', 'run.py'), 'utf8'), 'external change\n')
  })
  await check('delete and restore a complete bundle; refuse to overwrite a replacement', async () => {
    const skill = await item('resources')
    const removed = await service.remove(context, skill.id, skill.revision)
    await assert.rejects(fs.stat(skill.path), { code: 'ENOENT' })
    const restored = await service.restore(context, removed.backup.id)
    assert.equal(restored.skill.revision, skill.revision)
    assert.equal(await fs.readFile(join(skill.directory, 'scripts', 'run.py'), 'utf8'), 'external change\n')
    await assert.rejects(service.restore(context, removed.backup.id), /already been restored/)
    const again = await service.remove(context, skill.id, restored.skill.revision)
    await writeBundle((await source('project-dsh')).path, 'resources', text('replacement'))
    await assert.rejects(service.restore(context, again.backup.id), /overwrite changed/)
    assert.equal(await fs.readFile(skill.path, 'utf8'), text('replacement'))
  })
  await check('invalid local files can be deleted and restored for later repair', async () => {
    const skill = await item('broken')
    const removed = await service.remove(context, skill.id, skill.revision)
    const restored = await service.restore(context, removed.backup.id)
    assert.equal(restored.skill.valid, false)
    assert.equal(await fs.readFile(restored.skill.path, 'utf8'), '# No frontmatter')
  })
  await check('scope changes invalidate project skill refs and filter recoverable destinations', async () => {
    const skill = await item('new-skill')
    const other = { ...context, cwd: join(taskRoot, 'other-project') }
    await fs.mkdir(other.cwd)
    await assert.rejects(service.preview(other, skill.id), /current workspace/)
    await assert.rejects(service.save(other, skill.id, skill.revision, text('new-skill')), /current workspace/)
    assert.equal((await service.list(other)).projectRoot, other.cwd)
  })
  await check('custom/shared/bundled sources remain read-only; explicit defaults exclusion and launch cwd', async () => {
    const customContext = { ...context, configuration: { verified: true, includeDefaultRoots: false, customSkillDirs: ['custom'], bundledSkillDir: join(taskRoot, 'bundled') } }
    const customPath = join(context.processCwd, 'custom')
    await writeBundle(customPath, 'custom-only')
    const inventory = await service.list(customContext)
    assert.equal(inventory.configurationVerified, true)
    assert.deepEqual(inventory.sources.map(value => value.kind), ['custom', 'bundled'])
    assert.equal(inventory.sources[0].path, customPath)
    assert.equal(inventory.skills[0].writable, false)
    await assert.rejects(service.save(customContext, inventory.skills[0].id, inventory.skills[0].revision, text('custom-only')), /read-only/)
    await assert.rejects(service.create(context, (await source('project-agents')).id, 'shared', text('shared')), /writable/)
  })
  await check('selected YAML overlays expose only custom skill directories and never execute !!js', async () => {
    const profileDir = join(taskRoot, 'profile')
    await fs.mkdir(profileDir)
    await fs.writeFile(join(profileDir, 'cordis.patch.yml'), '- id: preset-standard\n  config:\n    plugins:\n      - id: skill-filesystem\n        config:\n          customSkillDirs: ["relative-skills"]\n      - id: unrelated\n        config:\n          apiKey: do-not-return\n          dangerous: !!js "neverExecute()"\n')
    const result = await readSkillConfiguration({ ...context, profileDir })
    assert.deepEqual(result.customSkillDirs, [join(context.processCwd, 'relative-skills')])
    assert.ok(!JSON.stringify(result).includes('do-not-return'))
    assert.ok(!JSON.stringify(result).includes('neverExecute'))
  })
  await check('symbolic links/junctions never escape the managed root; imports refuse linked resources', async () => {
    const outside = await writeBundle(join(taskRoot, 'outside'), 'outside')
    const project = await source('project-dsh')
    const link = join(project.path, 'linked')
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    const linked = (await service.list(context)).skills.find(value => value.directory === link)
    assert.equal(linked.writable, false)
    assert.equal(linked.valid, false)
    await assert.rejects(service.preview(context, linked.id), /Linked skill paths/)
    await assert.rejects(service.import(context, project.id, link), /Linked skill paths/)
    assert.equal(await fs.readFile(join(outside, 'SKILL.md'), 'utf8'), text('outside'))
    const incoming = await writeBundle(join(taskRoot, 'incoming'), 'with-link')
    await fs.symlink(outside, join(incoming, 'references'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(service.import(context, project.id, incoming), /Linked skill paths/)
    await assert.rejects(fs.stat(join(project.path, 'with-link')), { code: 'ENOENT' })
  })
  await check('linked source roots and multi-link instruction files cannot be modified', async () => {
    const isolated = { ...context, cwd: join(taskRoot, 'linked-project') }
    await fs.mkdir(join(isolated.cwd, '.dsh'), { recursive: true })
    const outside = join(taskRoot, 'outside-root')
    await fs.mkdir(outside)
    await fs.symlink(outside, join(isolated.cwd, '.dsh', 'skills'), process.platform === 'win32' ? 'junction' : 'dir')
    const inventory = await service.list(isolated)
    assert.equal(inventory.sources.find(value => value.kind === 'project-dsh').writable, false)
    const project = await source('project-dsh')
    const hard = join(project.path, 'hard.md')
    await fs.link(join((await item('new-skill')).directory, 'SKILL.md'), hard)
    const hardSkill = (await service.list(context)).skills.find(value => value.path === hard)
    assert.equal(hardSkill.writable, false)
    await fs.rm(hard)
  })
  await check('parallel create operations serialize and preserve the first successful skill', async () => {
    const project = await source('project-dsh')
    const outcomes = await Promise.allSettled([
      service.create(context, project.id, 'serialized', text('serialized', 'First')),
      service.create(context, project.id, 'serialized', text('serialized', 'Second'))
    ])
    assert.equal(outcomes[0].status, 'fulfilled')
    assert.equal(outcomes[1].status, 'rejected')
    assert.equal(await fs.readFile(join(project.path, 'serialized', 'SKILL.md'), 'utf8'), text('serialized', 'First'))
  })
  await check('injected copy failure rolls back only this import and preserves the original resources', async () => {
    const incoming = await writeBundle(join(taskRoot, 'incoming'), 'failed-import')
    await fs.writeFile(join(incoming, 'another.txt'), 'kept')
    const project = await source('project-dsh')
    const controlledLoader = createTypeScriptLoader({ 'node:fs/promises': {
      ...fs,
      copyFile: async (from, to, flags) => {
        if (to === join(project.path, 'failed-import', 'another.txt')) throw new Error('Injected destination copy failure')
        return fs.copyFile(from, to, flags)
      }
    } })
    const ControlledService = controlledLoader(new URL('../src/main/skills.ts', import.meta.url)).SkillsService
    await assert.rejects(new ControlledService(join(taskRoot, 'controlled-backups')).import(context, project.id, incoming), /Injected/)
    await assert.rejects(fs.stat(join(project.path, 'failed-import')), { code: 'ENOENT' })
    assert.equal(await fs.readFile(join(incoming, 'another.txt'), 'utf8'), 'kept')
    assert.equal((await fs.readdir(project.path)).filter(value => value.startsWith('.studio-')).length, 0)
  })
  for (const operation of ['save', 'remove']) {
    await check(`${operation} refuses to change source files when backup metadata cannot be written, and can retry`, async () => {
      const name = `metadata-${operation}`
      const project = await source('project-dsh')
      const directory = await writeBundle(project.path, name)
      const resource = Buffer.from([0, 42, 255, 17])
      await fs.writeFile(join(directory, 'resource.bin'), resource)
      const skill = await item(name)
      const backupRoot = join(taskRoot, `${name}-backups`)
      const fault = withBackupMetadataFailure(backupRoot)
      const run = () => operation === 'save'
        ? fault.service.save(context, skill.id, skill.revision, text(name, 'Edited'))
        : fault.service.remove(context, skill.id, skill.revision)

      fault.arm()
      await assert.rejects(run(), /Injected backup metadata failure/)
      assert.equal(fault.failures(), 1)
      assert.equal((await fault.service.preview(context, skill.id)).skill.revision, skill.revision)
      assert.equal(await fs.readFile(skill.path, 'utf8'), text(name))
      assert.deepEqual(await fs.readFile(join(directory, 'resource.bin')), resource)
      assert.deepEqual(await fault.service.backups(context), [])
      assert.deepEqual(await fs.readdir(backupRoot), [])
      assert.equal((await fs.readdir(project.path)).filter(value => value.startsWith('.studio-')).length, 0)

      fault.disarm()
      const result = await run()
      if (operation === 'save') assert.equal(await fs.readFile(skill.path, 'utf8'), text(name, 'Edited'))
      else await assert.rejects(fs.stat(skill.path), { code: 'ENOENT' })
      const restored = await fault.service.restore(context, result.backup.id)
      assert.equal(restored.skill.revision, skill.revision)
      assert.deepEqual(await fs.readFile(join(directory, 'resource.bin')), resource)
    })
  }
  await check('edit restore preserves current files and its original backup when inverse backup metadata fails', async () => {
    const name = 'metadata-restore'
    const project = await source('project-dsh')
    const directory = await writeBundle(project.path, name)
    await fs.writeFile(join(directory, 'resource.txt'), 'Original resource')
    const original = await item(name)
    const backupRoot = join(taskRoot, `${name}-backups`)
    const fault = withBackupMetadataFailure(backupRoot)
    const saved = await fault.service.save(context, original.id, original.revision, text(name, 'Edited'))

    fault.arm()
    await assert.rejects(fault.service.restore(context, saved.backup.id), /Injected backup metadata failure/)
    assert.equal(fault.failures(), 1)
    assert.equal((await fault.service.preview(context, original.id)).skill.revision, saved.skill.revision)
    assert.equal(await fs.readFile(original.path, 'utf8'), text(name, 'Edited'))
    assert.equal(await fs.readFile(join(directory, 'resource.txt'), 'utf8'), 'Original resource')
    assert.deepEqual(await fs.readdir(backupRoot), [saved.backup.id])
    const backups = await fault.service.backups(context)
    assert.equal(backups.length, 1)
    assert.equal(backups[0].restored, false)
    assert.equal((await fs.readdir(project.path)).filter(value => value.startsWith('.studio-')).length, 0)

    fault.disarm()
    const restored = await fault.service.restore(context, saved.backup.id)
    assert.equal(restored.skill.revision, original.revision)
    const inverse = (await fault.service.backups(context)).find(value => value.id !== saved.backup.id)
    assert.ok(inverse && !inverse.restored)
    await fault.service.restore(context, inverse.id)
    assert.equal((await fault.service.preview(context, original.id)).skill.revision, saved.skill.revision)
  })
  for (const format of ['bundle', 'file']) {
    await check(`save commits recoverable metadata before replacing a ${format} instruction`, async () => {
      const name = `save-record-${format}`
      const project = await source('project-dsh')
      if (format === 'bundle') {
        const directory = await writeBundle(project.path, name)
        await fs.mkdir(join(directory, 'empty'))
        await fs.writeFile(join(directory, 'resource.bin'), Buffer.from([0, 17, 255]))
      } else await fs.writeFile(join(project.path, `${name}.md`), text(name))
      const skill = await item(name)
      const backupRoot = join(taskRoot, `${name}-backups`)
      let fail = true
      const fault = withRecordUpdateFailure(backupRoot, record => fail && !!record.afterRevision)
      await assert.rejects(fault.service.save(context, skill.id, skill.revision, text(name, 'Edited')), /Injected backup record update failure/)
      assert.equal(fault.failures(), 1)
      assert.equal((await service.preview(context, skill.id)).skill.revision, skill.revision)
      assert.equal(await fs.readFile(skill.path, 'utf8'), text(name))
      for (const directory of await fs.readdir(backupRoot)) {
        assert.ok(!(await fs.readdir(join(backupRoot, directory))).some(value => value.startsWith('.record-')))
      }
      assert.equal((await fs.readdir(project.path)).filter(value => value.startsWith('.studio-')).length, 0)

      fail = false
      const saved = await fault.service.save(context, skill.id, skill.revision, text(name, 'Edited'))
      const restored = await fault.service.restore(context, saved.backup.id)
      assert.equal(restored.skill.revision, skill.revision)
    })
  }
  await check('edit restore commits inverse metadata before replacing the current instruction', async () => {
    const name = 'restore-inverse-record'
    const project = await source('project-dsh')
    await writeBundle(project.path, name)
    const skill = await item(name)
    const backupRoot = join(taskRoot, `${name}-backups`)
    const baseline = new SkillsService(backupRoot)
    const saved = await baseline.save(context, skill.id, skill.revision, text(name, 'Edited'))
    let fail = true
    const fault = withRecordUpdateFailure(backupRoot, record => fail && record.id !== saved.backup.id && !!record.afterRevision)
    await assert.rejects(fault.service.restore(context, saved.backup.id), /Injected backup record update failure/)
    assert.equal(fault.failures(), 1)
    assert.equal((await service.preview(context, skill.id)).skill.revision, saved.skill.revision)
    fail = false
    assert.equal((await fault.service.restore(context, saved.backup.id)).skill.revision, skill.revision)
  })
  for (const operation of ['edit', 'delete']) {
    await check(`${operation} restore can finish after final metadata failure without overwriting subsequent edits`, async () => {
      const name = `restore-final-${operation}`
      const project = await source('project-dsh')
      await writeBundle(project.path, name)
      const skill = await item(name)
      const backupRoot = join(taskRoot, `${name}-backups`)
      const baseline = new SkillsService(backupRoot)
      const saved = operation === 'edit'
        ? await baseline.save(context, skill.id, skill.revision, text(name, 'Edited'))
        : await baseline.remove(context, skill.id, skill.revision)
      let fail = true
      const fault = withRecordUpdateFailure(backupRoot, record => fail && record.id === saved.backup.id && record.restored)
      await assert.rejects(fault.service.restore(context, saved.backup.id), /Injected backup record update failure/)
      assert.equal(fault.failures(), 1)
      assert.equal((await service.preview(context, skill.id)).skill.revision, skill.revision)

      await fs.writeFile(skill.path, text(name, 'External edit'))
      await assert.rejects(fault.service.restore(context, saved.backup.id), /overwrite changed/)
      assert.equal(await fs.readFile(skill.path, 'utf8'), text(name, 'External edit'))
      await fs.writeFile(skill.path, text(name))
      fail = false
      // Recreate the service to prove recovery uses durable state, not memory.
      const resumed = new SkillsService(backupRoot)
      const restored = await resumed.restore(context, saved.backup.id)
      assert.equal(restored.skill.revision, skill.revision)
      assert.equal((await resumed.backups(context)).find(value => value.id === saved.backup.id).restored, true)
      if (operation === 'edit') {
        const inverse = (await resumed.backups(context)).find(value => value.id !== saved.backup.id && !value.restored)
        assert.ok(inverse)
        assert.equal((await resumed.restore(context, inverse.id)).skill.revision, saved.skill.revision)
      }
    })
  }
  if (process.platform === 'win32') {
    for (const instructionName of ['skill.md', 'SKILL.MD']) {
      await check(`Windows edits and inverse restores preserve ${instructionName} casing and resource revisions`, async () => {
        const name = instructionName === 'skill.md' ? 'lowercase-instruction' : 'uppercase-instruction'
        const project = await source('project-dsh')
        const directory = join(project.path, name)
        await fs.mkdir(join(directory, 'empty'), { recursive: true })
        await fs.writeFile(join(directory, instructionName), text(name))
        await fs.writeFile(join(directory, 'resource.bin'), Buffer.from([0, 55, 255]))
        const original = await item(name)
        const backupRoot = join(taskRoot, `${name}-backups`)
        const selected = new SkillsService(backupRoot)
        const saved = await selected.save(context, original.id, original.revision, text(name, 'Edited'))
        assert.ok((await fs.readdir(directory)).includes(instructionName))
        assert.equal((await selected.restore(context, saved.backup.id)).skill.revision, original.revision)
        const inverse = (await selected.backups(context)).find(value => value.id !== saved.backup.id && !value.restored)
        assert.ok(inverse)
        assert.equal((await selected.restore(context, inverse.id)).skill.revision, saved.skill.revision)
        assert.ok((await fs.readdir(directory)).includes(instructionName))
      })
    }
    await check('Windows restores a legacy edit whose replacement changed instruction filename casing', async () => {
      const name = 'legacy-instruction-casing'
      const project = await source('project-dsh')
      const directory = join(project.path, name)
      await fs.mkdir(directory)
      await fs.writeFile(join(directory, 'skill.md'), text(name))
      const original = await item(name)
      const backupRoot = join(taskRoot, `${name}-backups`)
      const selected = new SkillsService(backupRoot)
      const saved = await selected.save(context, original.id, original.revision, text(name, 'Edited'))
      // Older saves renamed to canonical SKILL.md, then recorded the resulting
      // tree revision. Recreate that persisted state to verify existing backups.
      await fs.rename(join(directory, 'skill.md'), join(directory, 'SKILL.md'))
      const legacy = await item(name)
      const recordPath = join(backupRoot, saved.backup.id, 'record.json')
      const record = JSON.parse(await fs.readFile(recordPath, 'utf8'))
      record.afterRevision = legacy.revision
      await fs.writeFile(recordPath, JSON.stringify(record))
      assert.equal((await selected.restore(context, saved.backup.id)).skill.revision, original.revision)
      assert.ok((await fs.readdir(directory)).includes('skill.md'))
      const inverse = (await selected.backups(context)).find(value => value.id !== saved.backup.id && !value.restored)
      assert.ok(inverse)
      assert.equal((await selected.restore(context, inverse.id)).skill.revision, legacy.revision)
      assert.ok((await fs.readdir(directory)).includes('SKILL.md'))
    })
  }
  process.stdout.write(`Passed ${passed} DSH skill filesystem regression groups.\n`)
} finally {
  const cleanPath = resolve(taskRoot)
  const base = resolve(tmpdir())
  const part = relative(base, cleanPath)
  assert.ok(part.startsWith('harness-skills-test-') && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  await fs.rm(cleanPath, { recursive: true, force: true })
}
