declare module 'js-yaml' {
  export function load(text: string, options?: { json?: boolean; schema?: unknown }): unknown
  export const CORE_SCHEMA: unknown
  export const DEFAULT_SCHEMA: { extend(types: unknown[]): unknown }
  export class Type {
    constructor(tag: string, options: { kind: string; construct(value: string): unknown })
  }
}
