// Monta as mesmas rotas /api/auth/* no servidor do Vite (npm run dev), para o login
// funcionar localmente sem `vercel dev`.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Plugin } from 'vite';
import { envFromProcess, handleAuth } from './authHandler';

export function authDevPlugin(env: Record<string, string | undefined>): Plugin {
  const authEnv = envFromProcess(env);
  if (!authEnv.sessionSecret) {
    // Só no desenvolvimento: um segredo temporário. Reiniciar o servidor encerra a sessão.
    authEnv.sessionSecret = randomBytes(32).toString('hex');
    console.warn('[auth] SESSION_SECRET ausente no .env.local; usando um segredo temporário (o login dura até reiniciar o dev server).');
  }
  return {
    name: 'mum-auth-dev',
    configureServer(server) {
      server.middlewares.use('/api/auth', async (req: IncomingMessage, res: ServerResponse) => {
        const action = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const url = `http://${req.headers.host}/api/auth/${action}`;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const request = new Request(url, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
        });
        const response = await handleAuth(request, action, authEnv);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}
