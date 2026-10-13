import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'src');
const runtimeStub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-runtime-stubs.mjs');
const extensions = ['.ts', '.tsx', '.js', '.mjs'];

function resolveFile(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  for (const extension of extensions) {
    const withExtension = `${candidate}${extension}`;
    if (fs.existsSync(withExtension) && fs.statSync(withExtension).isFile()) {
      return withExtension;
    }
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    for (const extension of extensions) {
      const index = path.join(candidate, `index${extension}`);
      if (fs.existsSync(index)) {
        return index;
      }
    }
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'react-native') {
    return { shortCircuit: true, url: pathToFileURL(runtimeStub).href };
  }
  if (specifier === '@react-native/assets-registry/registry') {
    const resolved = path.join(repoRoot, 'node_modules/@react-native/assets-registry/registry.js');
    return { shortCircuit: true, url: pathToFileURL(resolved).href };
  }
  if (specifier.startsWith('@/')) {
    const resolved = resolveFile(path.join(sourceRoot, specifier.slice(2)));
    if (resolved) {
      return { shortCircuit: true, url: pathToFileURL(resolved).href };
    }
  }

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : repoRoot;
    const resolved = resolveFile(path.resolve(path.dirname(parentPath), specifier));
    if (resolved) {
      return { shortCircuit: true, url: pathToFileURL(resolved).href };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.includes('/node_modules/') && /\.(ts|tsx)$/.test(url)) {
    const filename = fileURLToPath(url);
    const source = fs.readFileSync(filename, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    }).outputText;
    return { format: 'module', source: transpiled, shortCircuit: true };
  }
  return nextLoad(url, context);
}
