import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ErroApi, type StatusConsulta } from '../api';
import { STATUS } from '../formato';

/* ------------------------------- botões ------------------------------- */

type Variante = 'primario' | 'secundario' | 'perigo' | 'texto';
export function Botao({
  variante = 'primario',
  carregando,
  children,
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }) {
  return (
    <button {...p} className={`btn btn-${variante} ${className}`} disabled={p.disabled || carregando} aria-busy={carregando || undefined}>
      {children}
    </button>
  );
}

/* ------------------------------- campos ------------------------------- */

export function Campo({ rotulo, dica, erro, children, largo }: { rotulo: string; dica?: string; erro?: string; children: ReactNode; largo?: boolean }) {
  return (
    <label className={`campo ${largo ? 'campo-largo' : ''}`}>
      <span className="campo-rotulo">{rotulo}</span>
      {children}
      {dica && !erro && <span className="campo-dica">{dica}</span>}
      {erro && <span className="campo-erro">{erro}</span>}
    </label>
  );
}

/* ------------------------------ status ------------------------------ */

export function StatusConsultaTag({ status }: { status: StatusConsulta }) {
  return <span className={`tag tag-${status.toLowerCase()}`}>{STATUS[status]}</span>;
}

export function Tag({ tom = 'neutro', children }: { tom?: 'neutro' | 'ok' | 'alerta' | 'perigo' | 'info'; children: ReactNode }) {
  return <span className={`tag tag-tom-${tom}`}>{children}</span>;
}

/* ------------------------------ estados ------------------------------ */

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <p className="estado" role="status">
      <span className="spinner" aria-hidden /> {texto}
    </p>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <p className="vazio-titulo">{titulo}</p>
      {children && <div className="vazio-texto">{children}</div>}
    </div>
  );
}

export function Aviso({ tom = 'info', children }: { tom?: 'info' | 'erro' | 'ok' | 'alerta'; children: ReactNode }) {
  return (
    <div className={`aviso aviso-${tom}`} role={tom === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/* ------------------------------ cabeçalho ------------------------------ */

export function Cabecalho({ titulo, descricao, acoes }: { titulo: string; descricao?: ReactNode; acoes?: ReactNode }) {
  return (
    <header className="pagina-cabecalho">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p className="pagina-descricao">{descricao}</p>}
      </div>
      {acoes && <div className="pagina-acoes">{acoes}</div>}
    </header>
  );
}

/* -------------------------------- modal -------------------------------- */

export function Modal({ aberto, aoFechar, titulo, children, largo }: { aberto: boolean; aoFechar: () => void; titulo: string; children: ReactNode; largo?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog
      ref={ref}
      className={`modal ${largo ? 'modal-largo' : ''}`}
      onClose={aoFechar}
      onClick={(e) => {
        if (e.target === ref.current) aoFechar();
      }}
    >
      {aberto && (
        <div className="modal-corpo">
          <header className="modal-cabecalho">
            <h2>{titulo}</h2>
            <button type="button" className="modal-fechar" onClick={aoFechar} aria-label="Fechar">
              ×
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

/* -------------------------------- toasts -------------------------------- */

interface Toast { id: number; texto: string; tom: 'ok' | 'erro' }
const ToastCtx = createContext<(texto: string, tom?: 'ok' | 'erro') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mostrar = useCallback((texto: string, tom: 'ok' | 'erro' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texto, tom }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tom === 'erro' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tom}`}>
            {t.texto}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/**
 * Executa uma ação na API mostrando sucesso/erro.
 * Devolve [executar, executando].
 */
export function useAcao() {
  const toast = useToast();
  const [executando, setExecutando] = useState(false);
  const executar = useCallback(
    async <T,>(fn: () => Promise<T>, sucesso?: string): Promise<T | undefined> => {
      setExecutando(true);
      try {
        const r = await fn();
        if (sucesso) toast(sucesso);
        return r;
      } catch (e) {
        toast(e instanceof ErroApi ? e.message : 'Não foi possível concluir a ação.', 'erro');
        return undefined;
      } finally {
        setExecutando(false);
      }
    },
    [toast],
  );
  return [executar, executando] as const;
}

/* --------------------------------- abas --------------------------------- */

export function Abas<T extends string>({ valor, opcoes, aoMudar }: { valor: T; opcoes: { valor: T; rotulo: string; contagem?: number }[]; aoMudar: (v: T) => void }) {
  return (
    <div className="abas" role="tablist">
      {opcoes.map((o) => (
        <button key={o.valor} role="tab" aria-selected={valor === o.valor} className="aba" onClick={() => aoMudar(o.valor)}>
          {o.rotulo}
          {o.contagem !== undefined && <span className="aba-contagem">{o.contagem}</span>}
        </button>
      ))}
    </div>
  );
}
