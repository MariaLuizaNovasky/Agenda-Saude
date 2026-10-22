import type { Request, Response } from 'express';
import { lerToken } from './auth.js';

/**
 * Atualização em tempo real via Server-Sent Events.
 * Sempre que uma consulta muda, os clientes conectados recebem o evento
 * e recarregam a fila/agenda (meta do TAP: refletir em até 5 s).
 */
const clientes = new Set<Response>();

export function conectarEventos(req: Request, res: Response) {
  // EventSource não envia cabeçalhos, então o token vem na query string
  lerToken(String(req.query.token ?? ''));
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  clientes.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clientes.delete(res);
  });
}

export function emitir(evento: 'fila' | 'agenda' | 'notificacao', dados: Record<string, unknown> = {}) {
  const msg = `event: ${evento}\ndata: ${JSON.stringify({ ...dados, em: Date.now() })}\n\n`;
  for (const c of clientes) c.write(msg);
}
