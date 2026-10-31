import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Execute the real source modules in Node tests without generating build files. */
export function createTypeScriptLoader(mocks = {}, globals = {}) {
  const cache = new Map()
  const load = (input) => {
    let path = input instanceof URL ? fileURLToPath(input) : resolve(input)
    if (!existsSync(path)) path += '.ts'
    if (cache.has(path)) return cache.get(path).exports
    const module = { exports: {} }
    cache.set(path, module)
    const nativeRequire = createRequire(path)
    const require = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
      if (specifier.startsWith('@shared/')) return load(resolve(root, 'src/shared', specifier.slice(8)))
      if (specifier.startsWith('.')) {
        const candidate = resolve(dirname(path), specifier)
        if (candidate.endsWith('.ts') || existsSync(candidate + '.ts')) return load(candidate)
      }
      return nativeRequire(specifier)
    }
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText
    new Function('exports', 'require', 'module', '__filename', '__dirname', ...Object.keys(globals), compiled)(module.exports, require, module, path, dirname(path), ...Object.values(globals))
    return module.exports
  }
  return load
}
