import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'

// Read-only package inspection. This does not launch, install or publish an app.
const { values } = parseArgs({ options: {
  dir: { type: 'string' }, version: { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean' }
} })
const usage = 'Usage: node scripts/verify-release-artifacts.mjs --dir <release directory> --version <expected version> [--report <JSON file>]'
if (values.help) { console.log(usage); process.exit(0) }
assert.ok(values.dir && values.version, usage)
assert.match(values.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'Expected a semantic version')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = resolve(values.dir)
const stagingDir = join(artifactsDir, 'win-unpacked')
const version = values.version
const reportPath = values.report ? resolve(values.report) : undefined
if (reportPath) assert.equal(reportPath.toLowerCase().endsWith('.json'), true, '--report must be a JSON file')
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const yaml = require('js-yaml')
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))

async function digestFile(path) {
  const sha256 = createHash('sha256'), sha512 = createHash('sha512')
  let size = 0
  for await (const buffer of createReadStream(path)) {
    size += buffer.length
    sha256.update(buffer)
    sha512.update(buffer)
  }
  assert.equal(size, (await stat(path)).size, `File changed while hashing: ${path}`)
  return { size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') }
}

async function verifyExecutable(path) {
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    const dos = Buffer.alloc(64)
    assert.equal((await file.read(dos, 0, dos.length, 0)).bytesRead, dos.length, 'Truncated DOS header')
    assert.equal(dos.toString('ascii', 0, 2), 'MZ', `Not a Windows executable: ${path}`)
    const offset = dos.readUInt32LE(0x3c)
    assert.ok(offset >= 64 && offset + 26 <= size, `Invalid PE header offset: ${path}`)
    const pe = Buffer.alloc(26)
    assert.equal((await file.read(pe, 0, pe.length, offset)).bytesRead, pe.length)
    assert.deepEqual(pe.subarray(0, 4), Buffer.from([0x50, 0x45, 0, 0]), `Missing PE signature: ${path}`)
    assert.ok(pe.readUInt16LE(6) > 0, `PE has no sections: ${path}`)
    assert.ok(pe.readUInt16LE(20) >= 2 && offset + 24 + pe.readUInt16LE(20) <= size, `Invalid PE optional header: ${path}`)
    assert.ok(pe.readUInt16LE(22) & 0x0002, `PE is not executable: ${path}`)
    assert.ok([0x10b, 0x20b].includes(pe.readUInt16LE(24)), `Unknown PE optional header format: ${path}`)
    // The NSIS bootstrapper can be x86 even when the bundled app is x64.
    return { signature: 'PE', machine: '0x' + pe.readUInt16LE(4).toString(16), optionalHeaderMagic: '0x' + pe.readUInt16LE(24).toString(16) }
  } finally { await file.close() }
}

async function verify() {
  const pkg = await json(join(root, 'package.json'))
  const lock = await json(join(root, 'package-lock.json'))
  assert.deepEqual([pkg.version, lock.version, lock.packages?.['']?.version], [version, version, version], 'Repository package versions differ from --version')
  const names = [`Harness-Studio-${version}-x64-Setup.exe`, `Harness-Studio-${version}-x64-Portable.exe`, `Harness-Studio-${version}-x64-Setup.exe.blockmap`, 'latest.yml']
  const files = []
  for (const name of names) {
    const path = join(artifactsDir, name)
    const metadata = await stat(path)
    assert.ok(metadata.isFile() && metadata.size > 0, `Missing or empty artifact: ${name}`)
    const pe = name.endsWith('.exe') ? await verifyExecutable(path) : undefined
    files.push({ name, ...await digestFile(path), ...(pe ? { pe } : {}) })
  }
  const setup = files[0]
  const manifest = yaml.load(await readFile(join(artifactsDir, 'latest.yml'), 'utf8'))
  assert.equal(manifest?.version, version, 'Update manifest version differs')
  assert.equal(manifest.path, setup.name, 'Update manifest path differs from Setup')
  assert.equal(manifest.sha512, setup.sha512, 'Top-level update manifest SHA512 differs from Setup')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === 1, 'Expected one Setup entry in latest.yml')
  assert.equal(manifest.files[0].url, setup.name, 'Update manifest file URL differs from Setup')
  assert.equal(manifest.files[0].sha512, setup.sha512, 'File-entry update manifest SHA512 differs from Setup')
  assert.equal(manifest.files[0].size, setup.size, 'Update manifest Setup size differs')
  if (manifest.size !== undefined) assert.equal(manifest.size, setup.size, 'Top-level update manifest Setup size differs')

  const blockmap = JSON.parse(gunzipSync(await readFile(join(artifactsDir, names[2]))).toString('utf8'))
  assert.equal(String(blockmap.version), '2', 'Expected electron-builder blockmap format 2')
  assert.ok(Array.isArray(blockmap.files) && blockmap.files.length > 0, 'Blockmap has no files')
  let coveredBytes = 0, blocks = 0
  for (const entry of blockmap.files) {
    assert.equal(entry.offset, coveredBytes, 'Blockmap has a gap or overlap')
    assert.ok(Array.isArray(entry.checksums) && Array.isArray(entry.sizes) && entry.sizes.length > 0, 'Blockmap has no blocks')
    assert.equal(entry.checksums.length, entry.sizes.length, 'Blockmap checksum and size counts differ')
    assert.ok(entry.checksums.every(value => typeof value === 'string' && value.length > 0), 'Blockmap checksum is empty')
    assert.ok(entry.sizes.every(value => Number.isSafeInteger(value) && value > 0), 'Blockmap size is invalid')
    coveredBytes += entry.sizes.reduce((sum, size) => sum + size, 0)
    assert.ok(Number.isSafeInteger(coveredBytes), 'Blockmap coverage is not a safe integer')
    blocks += entry.sizes.length
  }
  assert.equal(coveredBytes, setup.size, 'Blockmap does not cover the full Setup executable')

  const archive = join(stagingDir, 'resources', 'app.asar')
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  assert.equal(packaged.name, pkg.name, 'Packaged app name differs')
  assert.equal(packaged.version, version, 'Packaged app version differs')
  const localFiles = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else {
        assert.ok(entry.isFile(), `Unexpected non-file in build output: ${path}`)
        localFiles.push(path)
      }
    }
  }
  await walk(join(root, 'out'))
  const outNames = localFiles.map(path => relative(root, path).replaceAll('\\', '/')).sort()
  assert.ok(outNames.length > 0, 'Current out directory has no build files')
  const archivePath = name => join(...name.split('/'))
  const bundleNames = asar.listPackage(archive)
    .map(name => name.replaceAll('\\', '/'))
    .filter(name => name.startsWith('/out/') && !asar.statFile(archive, archivePath(name.slice(1))).files)
    .map(name => name.slice(1)).sort()
  assert.deepEqual(bundleNames, outNames, 'Packaged out file set differs from current out')
  const comparisons = []
  for (const name of outNames) {
    const local = await readFile(join(root, name))
    const staged = asar.extractFile(archive, archivePath(name))
    const sha256 = createHash('sha256').update(local).digest('hex')
    assert.equal(staged.length, local.length, `Packaged out file size differs: ${name}`)
    assert.equal(createHash('sha256').update(staged).digest('hex'), sha256, `Packaged out file differs: ${name}`)
    comparisons.push({ name, size: local.length, sha256 })
  }
  return {
    version, checkedAt: new Date().toISOString(), passed: true, artifactsDir, stagingDir,
    rootVersionsVerified: true, windowsExecutableHeadersVerified: true,
    setupMatchesManifest: true, manifestSha512LocationsVerified: 2,
    manifestSizeLocationsVerified: manifest.size === undefined ? 1 : 2,
    blockmapFormat: String(blockmap.version), blockmapBlocks: blocks,
    blockmapCoveredBytes: coveredBytes, blockmapCoversCompleteSetup: true,
    files, packagedVersion: packaged.version, asar: await digestFile(archive),
    allPackagedOutFilesMatchCurrentBuild: true, comparisons,
    binaryBytes: files.filter(file => file.name.endsWith('.exe')).reduce((total, file) => total + file.size, 0),
    inspectionScope: 'Release package bytes, win-unpacked app.asar and current repository out only. PE headers, manifest hashes/sizes, blockmap coverage and packaged build identity; no install, launch, user configuration access or publication.'
  }
}

let report
try { report = await verify() }
catch (error) {
  report = { version, checkedAt: new Date().toISOString(), passed: false, artifactsDir, stagingDir, error: error instanceof Error ? error.message : String(error) }
  process.exitCode = 1
}
if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
}
console.log(JSON.stringify(report, null, 2))
