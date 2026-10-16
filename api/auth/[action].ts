// Função da Vercel para /api/auth/exchange, /api/auth/refresh e /api/auth/logout.
import { envFromProcess, handleAuth } from '../../server/authHandler';

export async function POST(request: Request): Promise<Response> {
  const action = new URL(request.url).pathname.split('/').pop() ?? '';
  return handleAuth(request, action, envFromProcess(process.env));
}

export function GET(request: Request): Promise<Response> {
  return handleAuth(request, '', envFromProcess(process.env));
}
