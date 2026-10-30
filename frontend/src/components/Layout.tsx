import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { api, type Notificacao, type Perfil } from '../api';
import { useAuth, useUsuario } from '../auth';
import { DIAS_SEMANA, PERFIL, relativoDia, hora } from '../formato';
import { IconeMenu, Simbolo } from './Icones';
import { fecharEventos, useCarregar, useEventos } from '../hooks';
import { TabManager } from './TabManager';

interface ItemMenu { para: string; rotulo: string }

/** Menu por perfil, conforme o diagrama de casos de uso. O Administrador herda a recepção. */
export const MENU: Record<Perfil, ItemMenu[]> = {
  PACIENTE: [
    { para: '/inicio', rotulo: 'Início' },
    { para: '/agendar', rotulo: 'Agendar consulta' },
    { para: '/consultas', rotulo: 'Minhas consultas' },
    { para: '/avaliacoes', rotulo: 'Avaliações' },
    { para: '/ajuda', rotulo: 'Central de ajuda' },
    { para: '/fila', rotulo: 'Fila de atendimento' },
    { para: '/historico', rotulo: 'Histórico' },
    { para: '/lista-espera', rotulo: 'Lista de espera' },
    { para: '/boletos', rotulo: 'Boletos' },
  ],
  RECEPCIONISTA: [
    { para: '/agenda', rotulo: 'Agenda do dia' },
    { para: '/fila', rotulo: 'Fila' },
    { para: '/lista-espera', rotulo: 'Lista de espera' },
    { para: '/retornos', rotulo: 'Retornos pendentes' },
    { para: '/pacientes', rotulo: 'Pacientes' },
    { para: '/ajuda', rotulo: 'Central de ajuda' },
    { para: '/dashboard', rotulo: 'Indicadores' },
    { para: '/comunicacao', rotulo: 'Comunicação' },
  ],
  ADMIN: [
    { para: '/dashboard', rotulo: 'Indicadores' },
    { para: '/agenda', rotulo: 'Agenda do dia' },
    { para: '/fila', rotulo: 'Fila' },
    { para: '/lista-espera', rotulo: 'Lista de espera' },
    { para: '/retornos', rotulo: 'Retornos pendentes' },
    { para: '/pacientes', rotulo: 'Pacientes' },
    { para: '/ajuda', rotulo: 'Central de ajuda' },
    { para: '/usuarios', rotulo: 'Usuários e acessos' },
    { para: '/cadastros', rotulo: 'Especialidades e convênios' },
    { para: '/boletos', rotulo: 'Boletos' },
    { para: '/relatorios', rotulo: 'Relatórios' },
    { para: '/comunicacao', rotulo: 'Comunicação' },
  ],
  MEDICO: [
    { para: '/atendimentos', rotulo: 'Meus atendimentos' },
    { para: '/agenda', rotulo: 'Minha agenda' },
    { para: '/disponibilidade', rotulo: 'Disponibilidade' },
    { para: '/retornos', rotulo: 'Retornos pendentes' },
    { para: '/exames', rotulo: 'Exames solicitados' },
    { para: '/comunicacao', rotulo: 'Comunicação' },
  ],
  FINANCEIRO: [
    { para: '/boletos', rotulo: 'Boletos' },
    { para: '/dashboard', rotulo: 'Indicadores' },
    { para: '/comunicacao', rotulo: 'Comunicação' },
  ],
  LABORATORIO: [{ para: '/exames', rotulo: 'Exames' }, { para: '/comunicacao', rotulo: 'Comunicação' }],
  FARMACIA: [{ para: '/receitas', rotulo: 'Retirada de receitas' }, { para: '/comunicacao', rotulo: 'Comunicação' }],
};

export function Layout() {
  const usuario = useUsuario();
  const { sair } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const [sidebarRecolhida, setSidebarRecolhida] = useState(() => {
    try {
      return localStorage.getItem('agenda-saude:sidebar-recolhida') === 'true';
    } catch {
      return false;
    }
  });
  const outlet = useOutlet();

  useEffect(() => setMenuAberto(false), [local.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('agenda-saude:sidebar-recolhida', String(sidebarRecolhida));
    } catch {
      // A preferência continua funcionando durante esta sessão.
    }
  }, [sidebarRecolhida]);

  return (
    <div className={`app ${sidebarRecolhida ? 'sidebar-recolhida' : ''}`}>
      <a href="#conteudo" className="pular">Ir para o conteúdo</a>
      <aside className={`lateral ${menuAberto ? 'aberta' : ''} ${sidebarRecolhida ? 'recolhida' : ''}`}>
        <div className="marca">
          <Simbolo />
          <span className="marca-nome">Agenda-Saúde</span>
          <button
            className="sidebar-botao"
            aria-label={sidebarRecolhida ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!sidebarRecolhida}
            aria-controls="menu-principal"
            title={sidebarRecolhida ? 'Expandir menu' : 'Recolher menu'}
            onClick={() => setSidebarRecolhida((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d={sidebarRecolhida ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="menu-botao"
            aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuAberto}
            aria-controls="menu-principal"
            title={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setMenuAberto((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d={menuAberto ? 'M5 5l14 14M19 5 5 19' : 'M4 7h16M4 12h16M4 17h16'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <nav id="menu-principal" className="menu" aria-label="Principal">
          {MENU[usuario.tipo].map((i) => (
            <NavLink key={i.para} to={i.para} className="menu-item" title={sidebarRecolhida ? i.rotulo : undefined}>
              <IconeMenu rota={i.para} />
              <span className="menu-rotulo">{i.rotulo}</span>
            </NavLink>
          ))}
        </nav>
        <div className="lateral-rodape">
          <NavLink to="/perfil" className="usuario-cartao" title={sidebarRecolhida ? `${usuario.nome} · ${PERFIL[usuario.tipo]}` : undefined}>
            <span className="avatar" aria-hidden>{iniciais(usuario.nome)}</span>
            <span className="usuario-textos">
              <span className="usuario-nome">{usuario.nome}</span>
              <span className="usuario-perfil">{PERFIL[usuario.tipo]}</span>
            </span>
          </NavLink>
          <button
            className="btn btn-texto sair"
            onClick={() => {
              fecharEventos();
              sair();
              navegar('/entrar');
            }}
          >
            Sair
          </button>
        </div>
      </aside>
      <div className="principal">
        <div className="barra-topo">
          <FolhaDoDia />
          <Notificacoes />
        </div>
        <TabManager
          key={`${usuario.id}:${usuario.tipo}`}
          outlet={outlet}
          menus={MENU[usuario.tipo]}
          perfil={usuario.tipo}
          usuarioId={usuario.id}
          caminhoInicial={MENU[usuario.tipo][0].para}
        />
      </div>
    </div>
  );
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** A data de hoje, no topo da folha. */
function FolhaDoDia() {
  const hoje = new Date();
  return (
    <p className="data-topo">
      <strong>{DIAS_SEMANA[hoje.getDay()]}</strong>, {hoje.getDate()} de {MESES[hoje.getMonth()]}
    </p>
  );
}

const iniciais = (nome: string) =>
  nome.replace(/^Dra?\.\s+/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function Notificacoes() {
  const [aberto, setAberto] = useState(false);
  const navegar = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { dados, recarregar } = useCarregar(() => api.get<Notificacao[]>('/notificacoes'));
  useEventos(['notificacao'], recarregar);
  const naoLidas = dados?.filter((n) => !n.lida).length ?? 0;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const abrir = async (n: Notificacao) => {
    if (!n.lida) await api.post(`/notificacoes/${n.id}/lida`).catch(() => {});
    setAberto(false);
    recarregar();
    if (n.link) navegar(n.link);
  };

  return (
    <div className="notif" ref={ref}>
      <button className="notif-botao" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M12 3a6 6 0 0 0-6 6v3.5L4 16h16l-2-3.5V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        <span>Avisos</span>
        {naoLidas > 0 && <span className="notif-contagem" aria-label={`${naoLidas} não lidos`}>{naoLidas}</span>}
      </button>
      {aberto && (
        <div className="notif-painel" role="dialog" aria-label="Avisos">
          <div className="notif-topo">
            <strong>Avisos</strong>
            {naoLidas > 0 && (
              <button className="btn btn-texto" onClick={() => api.post('/notificacoes/lidas').then(recarregar)}>
                Marcar todos como lidos
              </button>
            )}
          </div>
          {!dados?.length ? (
            <p className="notif-vazio">Nenhum aviso por enquanto.</p>
          ) : (
            <ul className="notif-lista">
              {dados.map((n) => (
                <li key={n.id}>
                  <button className={`notif-item ${n.lida ? '' : 'nova'}`} onClick={() => abrir(n)}>
                    <span className="notif-titulo">{n.titulo}</span>
                    <span className="notif-msg">{n.mensagem}</span>
                    <span className="notif-quando">{relativoDia(n.criado_em)}, {hora(n.criado_em)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
