/**
 * Minimal ambient typing for the single Node builtin the open-models report test
 * reads. @types/node is deliberately not part of this app's tsconfig (the bundle
 * is a browser target) and pulling it in would retype every file as Node code.
 */
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: string): string;
}
