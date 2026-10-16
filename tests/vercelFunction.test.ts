// @vitest-environment node
// Regressão do erro 500 em produção (ERR_MODULE_NOT_FOUND em /var/task/server/...).
//
// A Vercel compila cada .ts de api/ e das dependências para .js, sem empacotar, e o Node roda o
// resultado como ESM ("type": "module"). No ESM do Node, import relativo sem extensão não resolve.
// O Vite e o Vitest resolvem sozinhos, então os outros testes não pegam o problema. Aqui o código
// é transpilado como na Vercel e executado num processo `node` separado, sem o Vite no meio.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = join(__dirname, '..');

function tsFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('função da Vercel em Node ESM puro', () => {
  let out: string;
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'mum-vercel-'));
    writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const file of [...tsFiles('api'), ...tsFiles('server')]) {
      const js = ts.transpileModule(readFileSync(join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
      }).outputText;
      const dest = join(out, file.replace(/\.ts$/, '.js'));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, js);
    }
  });
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('imports relativos de api/ e server/ têm extensão .js (exigência do ESM do Node)', () => {
    const missing = [...tsFiles('api'), ...tsFiles('server')].flatMap((file) =>
      // import/export ... from '…', import '…' (efeito colateral) e import('…'), com aspas simples ou duplas.
      [...readFileSync(join(root, file), 'utf8').matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
        .map((m) => m[1])
        .filter((spec) => !spec.endsWith('.js'))
        .map((spec) => `${relative(root, join(root, file))}: ${spec}`),
    );
    expect(missing).toEqual([]);
  });

  it('/api/auth/refresh sem sessão carrega o módulo e responde 401 (não 500)', () => {
    const fn = pathToFileURL(join(out, 'api', 'auth', '[action].js')).href;
    const script = `
      const { POST } = await import(${JSON.stringify(fn)});
      const origin = 'https://mum.example';
      const res = await POST(new Request(origin + '/api/auth/refresh', {
        method: 'POST', headers: { 'x-mum': '1', origin },
      }));
      process.stdout.write(String(res.status));
    `;
    const status = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: out,
      // Valores de teste: nenhum segredo real.
      env: { ...process.env, VITE_SPOTIFY_CLIENT_ID: 'c'.repeat(32), SESSION_SECRET: 't'.repeat(40) },
      encoding: 'utf8',
    });
    expect(status).toBe('401');
  });
});
