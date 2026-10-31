// Guard against a silent, total preload failure.
//
// Sandboxed preloads (`sandbox: true`) can only `require('electron')` and Node
// builtins. When two preload entries import the same `@shared/*` module, Rollup
// splits it into `chunks/*.js` and every preload starts with
// `require("./chunks/...")`, which throws inside the sandbox. The window then
// renders with no `window.studio` and the UI hangs on the splash screen.
//
// This check turns that silent failure into a build error.
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const preloadDir = join(root, 'out', 'preload')
const RELATIVE_REQUIRE = /\brequire\(\s*["']\.\.?\//
const IPC_METHODS = new Set(['on', 'once', 'send', 'sendSync', 'invoke', 'off', 'removeListener', 'removeAllListeners'])

function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) {
    node = node.expression
  }
  return node
}

function constants(source) {
  const values = new Map()
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      values.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return values
}

function literal(node, checker, seen = new Set()) {
  node = unwrap(node)
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node)
    const declaration = symbol?.valueDeclaration
    if (symbol && !seen.has(symbol) && declaration && ts.isVariableDeclaration(declaration)) {
      return literal(declaration.initializer, checker, new Set([...seen, symbol]))
    }
  }
  return undefined
}

async function checkWorkspaceChannels() {
  const contractPath = join(root, 'src', 'shared', 'channels.ts')
  const workspacePath = join(root, 'src', 'preload', 'workspace.ts')
  // Binding identifiers (without resolving imports or loading libraries) keeps
  // constant aliases scoped correctly, including aliases inside callbacks.
  const program = ts.createProgram([contractPath, workspacePath], { noResolve: true, noLib: true, types: [] })
  const checker = program.getTypeChecker()
  const contractSource = program.getSourceFile(contractPath)
  const workspaceSource = program.getSourceFile(workspacePath)
  if (!contractSource || !workspaceSource) throw new Error('Workspace IPC check source files are missing')
  const contractConstants = constants(contractSource)
  const object = unwrap(contractConstants.get('IPC'))
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error('Shared IPC contract must be a constant object')
  const contract = new Map()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
    const value = literal(property.initializer, checker)
    if (key && value !== undefined) contract.set(key, value)
  }
  const knownChannels = new Set(contract.values())
  const errors = []
  let calls = 0
  const visit = (node) => {
    // Named constants also check their semantic key, so a theme constant set to
    // another valid IPC channel cannot slip through. Local aliases may have names
    // that do not define a new contract key; their uses are still checked below.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^GUEST_[A-Z_]+_CHANNEL$/.test(node.name.text)) {
      const name = node.name.text
      const key = name.slice(0, -'_CHANNEL'.length).toLowerCase().replace(/_([a-z])/g, (_match, char) => char.toUpperCase())
      const value = literal(node.initializer, checker)
      if (value === undefined || !knownChannels.has(value)) {
        errors.push(`${name}: unknown IPC channel ${value ?? 'nonconstant channel'}`)
      } else if (contract.has(key) && value !== contract.get(key)) {
        errors.push(`${name}: expected ${contract.get(key)}, received ${value ?? 'nonconstant channel'}`)
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ipcRenderer'
      && IPC_METHODS.has(node.expression.name.text)) {
      calls++
      const value = literal(node.arguments[0], checker)
      if (value === undefined || !knownChannels.has(value)) {
        const position = workspaceSource.getLineAndCharacterOfPosition(node.getStart(workspaceSource))
        errors.push(`src/preload/workspace.ts:${position.line + 1}: unknown IPC channel ${value ?? 'nonconstant channel'}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(workspaceSource)
  if (!calls) errors.push('Workspace preload contains no statically checked IPC calls')
  if (errors.length) {
    console.error('workspace preload IPC channels do not match src/shared/channels.ts:')
    for (const error of errors) console.error(`  ${error}`)
    process.exit(1)
  }
  return calls
}

async function walk(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, files)
    else if (entry.name.endsWith('.js')) files.push(full)
  }
}

const checkedChannels = await checkWorkspaceChannels()
const files = []
await walk(preloadDir, files)

const offenders = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  const match = source.match(RELATIVE_REQUIRE)
  if (match) offenders.push({ file: relative(process.cwd(), file), snippet: match[0] })
}

if (offenders.length > 0) {
  console.error('preload bundles are not self-contained:')
  for (const item of offenders) console.error(`  ${item.file}  ->  ${item.snippet}...`)
  console.error('')
  console.error('A sandboxed preload cannot require a relative file. Importing one')
  console.error('shared module from two preload entries makes Rollup split it out.')
  console.error('Inline the constant in the preload, or move it to a type-only import.')
  process.exit(1)
}

console.log(`preload check: ${files.length} bundle(s) self-contained`)
console.log(`preload check: ${checkedChannels} workspace IPC call(s) match the shared contract`)
