import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Perfil } from '../api';

interface ItemMenu { para: string; rotulo: string }
interface AbaInterna { caminho: string; busca: string; hash: string; titulo: string; suja: boolean }

interface TabManagerProps {
  outlet: ReactNode;
  menus: ItemMenu[];
  perfil: Perfil;
  usuarioId: number;
  caminhoInicial: string;
}

const chave = (caminho: string) => caminho || '/';
const endereco = (caminho: string, busca = '', hash = '') => `${caminho}${busca}${hash}`;

function tituloDaAba(caminho: string, menus: ItemMenu[]) {
  const menu = menus.find((item) => item.para === caminho);
  if (menu) return menu.rotulo;
  if (caminho === '/perfil') return 'Meu perfil';
  const atendimento = caminho.match(/^\/atendimento\/([^/]+)$/);
  if (atendimento) return `Atendimento #${atendimento[1]}`;
  return 'Página';
}

function rotaPermitida(caminho: string, menus: ItemMenu[], perfil: Perfil) {
  if (caminho === '/perfil' || menus.some((item) => item.para === caminho)) return true;
  return perfil === 'MEDICO' && /^\/atendimento\/\d+$/.test(caminho);
}

function lerAbas(chaveStorage: string, menus: ItemMenu[], perfil: Perfil): AbaInterna[] {
  try {
    const salvas: unknown = JSON.parse(sessionStorage.getItem(chaveStorage) ?? '[]');
    if (!Array.isArray(salvas)) return [];
    return salvas
      .filter((aba): aba is { caminho: string; busca?: string; hash?: string; titulo: string } =>
        !!aba && typeof aba.caminho === 'string' && rotaPermitida(aba.caminho, menus, perfil),
      )
      .map((aba) => ({
        caminho: aba.caminho,
        busca: typeof aba.busca === 'string' ? aba.busca : '',
        hash: typeof aba.hash === 'string' ? aba.hash : '',
        titulo: aba.titulo,
        suja: false,
      }));
  } catch {
    return [];
  }
}

export function TabManager({ outlet, menus, perfil, usuarioId, caminhoInicial }: TabManagerProps) {
  const local = useLocation();
  const navegar = useNavigate();
  const [abas, setAbas] = useState<AbaInterna[]>(() =>
    lerAbas(`agenda-saude:abas:${usuarioId}`, menus, perfil),
  );
  const [abasSujas, setAbasSujas] = useState<Set<string>>(() => new Set());
  const [paginas, setPaginas] = useState<Map<string, ReactNode>>(() => new Map());
  const caminhoAtual = chave(local.pathname);

  useEffect(() => {
    setAbas((atuais) => {
      const titulo = tituloDaAba(local.pathname, menus);
      const existente = atuais.find((aba) => chave(aba.caminho) === caminhoAtual);
      if (existente?.titulo === titulo && existente.busca === local.search && existente.hash === local.hash) return atuais;
      if (existente) return atuais.map((aba) =>
        chave(aba.caminho) === caminhoAtual
          ? { ...aba, titulo, busca: local.search, hash: local.hash }
          : aba,
      );
      return [...atuais, { caminho: local.pathname, busca: local.search, hash: local.hash, titulo, suja: false }];
    });
  }, [caminhoAtual, local.pathname, local.search, local.hash, menus]);

  useEffect(() => {
    if (!outlet) return;
    setPaginas((atuais) => {
      if (atuais.has(caminhoAtual)) return atuais;
      const novas = new Map(atuais);
      novas.set(caminhoAtual, outlet);
      return novas;
    });
  }, [caminhoAtual, outlet]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        `agenda-saude:abas:${usuarioId}`,
        JSON.stringify(abas.map(({ caminho, busca, hash, titulo }) => ({ caminho, busca, hash, titulo }))),
      );
    } catch {
      // As abas continuam funcionando mesmo sem armazenamento de sessão.
    }
  }, [abas, usuarioId]);

  useEffect(() => {
    const salvo = () => setAbasSujas((atuais) => {
      if (!atuais.has(caminhoAtual)) return atuais;
      const novas = new Set(atuais);
      novas.delete(caminhoAtual);
      return novas;
    });
    window.addEventListener('agenda-saude:formulario-salvo', salvo);
    return () => window.removeEventListener('agenda-saude:formulario-salvo', salvo);
  }, [caminhoAtual]);

  useEffect(() => {
    if (!abasSujas.size) return;
    const avisar = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
      evento.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [abasSujas]);

  const ativar = (aba: AbaInterna) => {
    if (chave(aba.caminho) !== caminhoAtual) navegar(endereco(aba.caminho, aba.busca, aba.hash));
  };

  const fechar = (aba: AbaInterna) => {
    const alvo = chave(aba.caminho);
    if (abasSujas.has(alvo) && !window.confirm(`A aba "${aba.titulo}" tem alterações que podem não estar salvas. Fechar mesmo assim?`)) return;

    const restantes = abas.filter((item) => chave(item.caminho) !== alvo);
    setAbas(restantes);
    setAbasSujas((atuais) => {
      const novas = new Set(atuais);
      novas.delete(alvo);
      return novas;
    });
    setPaginas((atuais) => {
      const novas = new Map(atuais);
      novas.delete(alvo);
      return novas;
    });

    if (alvo === caminhoAtual) {
      const proxima = restantes[Math.max(0, abas.findIndex((item) => chave(item.caminho) === alvo) - 1)];
      navegar(proxima ? endereco(proxima.caminho, proxima.busca, proxima.hash) : caminhoInicial, { replace: true });
    }
  };

  const marcarAlteracao = (evento: FormEvent<HTMLElement>) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLElement) || !campo.closest('form')) return;
    if (campo instanceof HTMLInputElement && ['search', 'date', 'submit', 'button', 'reset'].includes(campo.type)) return;
    setAbasSujas((atuais) => {
      if (atuais.has(caminhoAtual)) return atuais;
      const novas = new Set(atuais);
      novas.add(caminhoAtual);
      return novas;
    });
  };

  return (
    <>
      <div className="barra-abas" role="tablist" aria-label="Páginas abertas">
        <div className="abas-internas">
          {abas.map((aba) => {
            const ativa = chave(aba.caminho) === caminhoAtual;
            const suja = abasSujas.has(chave(aba.caminho));
            return (
              <div
                className={`aba-interna ${ativa ? 'ativa' : ''}`}
                key={chave(aba.caminho)}
                role="presentation"
                title={aba.caminho}
              >
                <button
                  className="aba-selecionar"
                  type="button"
                  role="tab"
                  aria-selected={ativa}
                  aria-label={suja ? `${aba.titulo}, alterações não salvas` : aba.titulo}
                  onClick={() => ativar(aba)}
                >
                  <span className="aba-interna-titulo">{suja && <span className="aba-alterada" aria-hidden="true">●</span>}{aba.titulo}</span>
                </button>
                <button
                  className="aba-fechar"
                  type="button"
                  aria-label={`Fechar aba ${aba.titulo}`}
                  title={`Fechar ${aba.titulo}`}
                  onClick={(evento) => {
                    evento.stopPropagation();
                    fechar(aba);
                  }}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                    <path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <main
        id="conteudo"
        className="conteudo"
        onChangeCapture={marcarAlteracao}
        onInputCapture={marcarAlteracao}
      >
        {abas.map((aba) => {
          const caminho = chave(aba.caminho);
          const ativa = caminho === caminhoAtual;
          const pagina = ativa ? outlet : paginas.get(caminho);
          if (!pagina) return null;
          return (
            <div className="aba-conteudo" key={caminho} hidden={!ativa} aria-hidden={!ativa}>
              {pagina}
            </div>
          );
        })}
      </main>
    </>
  );
}
