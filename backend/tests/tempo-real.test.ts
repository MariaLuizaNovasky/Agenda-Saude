// Meta do TAP: fila atualizada entre sessões em até 5 s
import { describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import { EMAILS, entrar, get, hojeISO, post, servidor } from './helpers.js';

describe('eventos em tempo real (SSE)', () => {
  it('recusa conexão sem token válido', async () => {
    const { port } = servidor.address() as AddressInfo;
    const r = await fetch(`http://127.0.0.1:${port}/api/eventos?token=invalido`);
    expect(r.status).toBe(401);
  });

  it('uma mudança na fila chega às sessões abertas em menos de 5 s', async () => {
    const { port } = servidor.address() as AddressInfo;
    const rec = await entrar(EMAILS.recepcao);
    const ctl = new AbortController();
    const resp = await fetch(`http://127.0.0.1:${port}/api/eventos?token=${rec.token}`, { signal: ctl.signal });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);

    const leitor = resp.body!.getReader();
    const dec = new TextDecoder();
    const recebido = new Promise<number>((ok, falha) => {
      const inicio = Date.now();
      const timer = setTimeout(() => falha(new Error('evento não chegou em 5 s')), 5000);
      (async () => {
        let acum = '';
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) return;
          acum += dec.decode(value);
          if (/event: fila/.test(acum)) { clearTimeout(timer); ok(Date.now() - inicio); return; }
        }
      })().catch(() => {});
    });

    const hoje = await get(EMAILS.ana, `/api/consultas?data=${hojeISO()}&status=AGENDADA`);
    await post(EMAILS.ana, `/api/consultas/${hoje.body[0].id}/checkin`);

    const ms = await recebido;
    expect(ms).toBeLessThan(5000);
    ctl.abort();
  });
});
