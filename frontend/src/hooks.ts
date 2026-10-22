import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, ErroApi, getToken } from './api';

/** Carrega dados de uma chamada à API, com recarga manual. */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const recarregar = useCallback(async () => {
    try {
      const r = await fnRef.current();
      setDados(r);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setCarregando(true);
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { dados, erro, carregando, recarregar, setDados };
}

type Evento = 'fila' | 'agenda' | 'notificacao';

/**
 * Tempo real: escuta os eventos enviados pelo servidor (SSE).
 * Uma única conexão é compartilhada por todos os componentes.
 */
const ouvintes = new Map<Evento, Set<() => void>>();
let fonte: EventSource | null = null;
let tokenFonte: string | null = null;

function garantirConexao() {
  const token = getToken();
  if (!token) return;
  if (fonte && tokenFonte === token && fonte.readyState !== EventSource.CLOSED) return;
  fonte?.close();
  tokenFonte = token;
  fonte = new EventSource(`${API_URL}/api/eventos?token=${encodeURIComponent(token)}`);
  for (const ev of ['fila', 'agenda', 'notificacao'] as Evento[]) {
    fonte.addEventListener(ev, () => ouvintes.get(ev)?.forEach((f) => f()));
  }
}

export function fecharEventos() {
  fonte?.close();
  fonte = null;
}

export function useEventos(eventos: Evento[], aoReceber: () => void) {
  const ref = useRef(aoReceber);
  ref.current = aoReceber;
  const chave = eventos.join(',');
  useEffect(() => {
    garantirConexao();
    // agrupa rajadas de eventos numa única recarga
    let t: ReturnType<typeof setTimeout> | undefined;
    const f = () => {
      clearTimeout(t);
      t = setTimeout(() => ref.current(), 250);
    };
    const lista = chave.split(',') as Evento[];
    for (const e of lista) {
      if (!ouvintes.has(e)) ouvintes.set(e, new Set());
      ouvintes.get(e)!.add(f);
    }
    return () => {
      clearTimeout(t);
      for (const e of lista) ouvintes.get(e)?.delete(f);
    };
  }, [chave]);
}

/** Relógio que atualiza a cada minuto (para "há x min"). */
export function useAgora(intervaloMs = 30000) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}
