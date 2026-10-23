import { useEffect, useState, type FormEvent } from 'react';
import { api, type Medico, type Perfil, type Usuario } from '../api';
import { useUsuario } from '../auth';
import { Aviso, Botao, Cabecalho, Campo, useToast } from '../components/ui';
import { dataHora } from '../formato';

type PerfilInterno = Exclude<Perfil, 'PACIENTE'>;
type AcaoAuditoria = 'AVISO_PUBLICADO' | 'AVISO_REMOVIDO' | 'MENSAGEM_ENVIADA';

interface AvisoComunicacao {
  id: string;
  titulo: string;
  mensagem: string;
  destinatarios: PerfilInterno[];
  autor: string;
  criadoEm: string;
}

interface MensagemChat {
  id: string;
  texto: string;
  autor: string;
  perfil: PerfilInterno;
  autorId?: number;
  destinatarioId?: number;
  crm?: string;
  criadoEm: string;
}

interface ContatoInterno {
  id: number;
  nome: string;
  perfil: PerfilInterno;
  crm?: string;
  especialidades?: string;
}

interface RegistroAuditoria {
  id: string;
  acao: AcaoAuditoria;
  descricao: string;
  usuario: string;
  usuarioId?: number;
  perfil: PerfilInterno;
  crm?: string;
  especialidades?: string;
  criadoEm: string;
}

interface EstadoComunicacao {
  avisos: AvisoComunicacao[];
  mensagens: MensagemChat[];
  auditoria: RegistroAuditoria[];
  leituras: Record<string, string[]>;
}

const CHAVE_ESTADO = 'agenda-saude:comunicacao:v2';
const CHAVE_ANTIGA = 'agenda-saude:comunicacao:v1';
const CHAVE_CONTATOS = 'agenda-saude:comunicacao:contatos:v1';
const PERFIS: PerfilInterno[] = ['RECEPCIONISTA', 'MEDICO', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'];
const ROTULOS: Record<PerfilInterno, string> = {
  RECEPCIONISTA: 'Recepção',
  MEDICO: 'Médicos',
  ADMIN: 'Administradores',
  FINANCEIRO: 'Financeiro',
  LABORATORIO: 'Laboratório',
  FARMACIA: 'Farmácia',
};
const ESTADO_VAZIO: EstadoComunicacao = { avisos: [], mensagens: [], auditoria: [], leituras: {} };

function novoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dataAtual() {
  return new Date().toISOString();
}

function criarRegistroAuditoria(usuario: Usuario, acao: AcaoAuditoria, descricao: string, contatos: ContatoInterno[]): RegistroAuditoria {
  const contato = contatos.find((item) => item.id === usuario.id && item.perfil === usuario.tipo);
  return {
    id: novoId(),
    acao,
    descricao,
    usuario: usuario.nome,
    usuarioId: usuario.id,
    perfil: usuario.tipo as PerfilInterno,
    ...(usuario.tipo === 'MEDICO'
      ? { crm: usuario.crm ? `${usuario.crm}${usuario.crm_uf ? `/${usuario.crm_uf}` : ''}` : 'Não informado' }
      : {}),
    ...(usuario.tipo === 'MEDICO' && contato?.especialidades ? { especialidades: contato.especialidades } : {}),
    criadoEm: dataAtual(),
  };
}

function lerEstado(): EstadoComunicacao {
  const salvo = localStorage.getItem(CHAVE_ESTADO);
  if (salvo) {
    const dados: unknown = JSON.parse(salvo);
    if (
      dados === null ||
      typeof dados !== 'object' ||
      !Array.isArray((dados as EstadoComunicacao).avisos) ||
      !Array.isArray((dados as EstadoComunicacao).mensagens) ||
      !Array.isArray((dados as EstadoComunicacao).auditoria)
    ) {
      throw new Error('Os dados de comunicação salvos neste navegador estão inválidos.');
    }
    const estado = dados as EstadoComunicacao;
    return { ...estado, leituras: estado.leituras ?? {} };
  }

  const legado = localStorage.getItem(CHAVE_ANTIGA);
  if (!legado) return ESTADO_VAZIO;
  const avisos: unknown = JSON.parse(legado);
  if (!Array.isArray(avisos)) throw new Error('O quadro de avisos salvo neste navegador está inválido.');
  return { ...ESTADO_VAZIO, avisos: avisos as AvisoComunicacao[] };
}

function gravarEstado(estado: EstadoComunicacao) {
  localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estado));
}

function lerContatos(): ContatoInterno[] {
  const salvo = localStorage.getItem(CHAVE_CONTATOS);
  if (!salvo) return [];
  const dados: unknown = JSON.parse(salvo);
  if (!Array.isArray(dados)) throw new Error('A lista de perfis internos salva neste navegador está inválida.');
  return dados.filter((item): item is ContatoInterno =>
    item !== null &&
    typeof item === 'object' &&
    typeof item.id === 'number' &&
    typeof item.nome === 'string' &&
    PERFIS.includes(item.perfil),
  );
}

function crmFormatado(crm?: string | null, uf?: string | null) {
  return crm ? `${crm}${uf ? `/${uf}` : ''}` : undefined;
}

function normalizarBusca(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function Comunicacao() {
  const usuario = useUsuario();
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoComunicacao>(ESTADO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [mensagemAviso, setMensagemAviso] = useState('');
  const [destinatarios, setDestinatarios] = useState<PerfilInterno[]>([]);
  const [textoChat, setTextoChat] = useState('');
  const [chatAberto, setChatAberto] = useState(false);
  const [contatos, setContatos] = useState<ContatoInterno[]>([]);
  const [conversaId, setConversaId] = useState<string>('equipe');
  const [erroContatos, setErroContatos] = useState<string | null>(null);
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [filtroCrm, setFiltroCrm] = useState('');
  const [filtroEspecialidade, setFiltroEspecialidade] = useState('');
  const [filtroDataInicial, setFiltroDataInicial] = useState('');
  const [filtroDataFinal, setFiltroDataFinal] = useState('');
  const [filtroPalavra, setFiltroPalavra] = useState('');

  useEffect(() => {
    const carregar = () => {
      try {
        setEstado(lerEstado());
        setErro(null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar a comunicação salva neste navegador.');
      }
    };
    carregar();
    window.addEventListener('storage', carregar);
    return () => window.removeEventListener('storage', carregar);
  }, []);

  useEffect(() => {
    let ativo = true;
    const carregarContatos = async () => {
      let anteriores: ContatoInterno[] = [];
      try {
        anteriores = lerContatos();
      } catch (e) {
        if (ativo) setErroContatos(e instanceof Error ? e.message : 'Não foi possível ler os perfis internos salvos.');
      }

      const mesclar = (novos: ContatoInterno[]) => {
        const mapa = new Map<string, ContatoInterno>();
        for (const contato of [...anteriores, ...novos]) {
          const chave = `${contato.perfil}:${contato.id}`;
          const existente = mapa.get(chave);
          mapa.set(chave, {
            ...existente,
            ...contato,
            crm: contato.crm ?? existente?.crm,
            especialidades: contato.especialidades ?? existente?.especialidades,
          });
        }
        const lista = [...mapa.values()].filter((contato) => !(contato.id === usuario.id && contato.perfil === usuario.tipo));
        if (ativo) setContatos(lista.sort((a, b) => a.nome.localeCompare(b.nome)));
        try {
          localStorage.setItem(CHAVE_CONTATOS, JSON.stringify([...mapa.values()]));
          if (ativo) setErroContatos(null);
        } catch (e) {
          if (ativo) setErroContatos(e instanceof Error ? e.message : 'Não foi possível salvar os perfis neste navegador.');
        }
      };

      const atual: ContatoInterno = {
        id: usuario.id,
        nome: usuario.nome,
        perfil: usuario.tipo as PerfilInterno,
        ...(usuario.tipo === 'MEDICO' ? { crm: crmFormatado(usuario.crm, usuario.crm_uf) } : {}),
      };
      const carregamentos: Promise<ContatoInterno[]>[] = [Promise.resolve([atual])];
      carregamentos.push(
        api.get<Medico[]>('/medicos').then((medicos) => medicos.map((medico) => ({
          id: medico.id,
          nome: medico.nome,
          perfil: 'MEDICO' as const,
          crm: crmFormatado(medico.crm, medico.crm_uf),
          especialidades: medico.especialidades ?? undefined,
        }))),
      );
      if (usuario.tipo === 'ADMIN') {
        carregamentos.push(
          api.get<(Usuario & { ativo?: number })[]>('/usuarios').then((usuarios) => usuarios
            .filter((membro) => membro.tipo !== 'PACIENTE' && membro.ativo !== 0)
            .map((membro) => ({
              id: membro.id,
              nome: membro.nome,
              perfil: membro.tipo as PerfilInterno,
              ...(membro.tipo === 'MEDICO' ? { crm: crmFormatado(membro.crm, membro.crm_uf) } : {}),
            }))),
        );
      }

      const resultados = await Promise.allSettled(carregamentos);
      const encontrados = resultados.flatMap((resultado) => resultado.status === 'fulfilled' ? resultado.value : []);
      const falha = resultados.find((resultado): resultado is PromiseRejectedResult => resultado.status === 'rejected');
      if (falha && ativo) {
        setErroContatos(falha.reason instanceof Error ? falha.reason.message : 'Não foi possível carregar todos os perfis da equipe.');
      }
      mesclar(encontrados);
    };
    void carregarContatos();
    return () => { ativo = false; };
  }, [usuario.id, usuario.nome, usuario.tipo, usuario.crm, usuario.crm_uf]);

  const persistir = (proximo: EstadoComunicacao, sucesso: string): boolean => {
    try {
      gravarEstado(proximo);
      setEstado(proximo);
      setErro(null);
      toast(sucesso);
      return true;
    } catch (e) {
      const texto = e instanceof Error ? e.message : 'Não foi possível salvar no armazenamento deste navegador.';
      setErro(texto);
      toast(texto, 'erro');
      return false;
    }
  };

  const publicar = (e: FormEvent) => {
    e.preventDefault();
    const tituloLimpo = titulo.trim();
    const texto = mensagemAviso.trim();
    if (!tituloLimpo || !texto || destinatarios.length === 0) {
      toast('Preencha título, mensagem e selecione ao menos um destinatário interno.', 'erro');
      return;
    }
    try {
      const atual = lerEstado();
      const novo: AvisoComunicacao = {
        id: novoId(),
        titulo: tituloLimpo,
        mensagem: texto,
        destinatarios,
        autor: usuario.nome,
        criadoEm: dataAtual(),
      };
      const salvo = persistir({
        ...atual,
        avisos: [novo, ...atual.avisos],
        auditoria: [criarRegistroAuditoria(usuario, 'AVISO_PUBLICADO', `Publicou o aviso "${tituloLimpo}" para ${destinatarios.map((p) => ROTULOS[p]).join(', ')}.`, contatos), ...atual.auditoria],
      }, 'Aviso publicado neste navegador.');
      if (!salvo) return;
      setTitulo('');
      setMensagemAviso('');
      setDestinatarios([]);
    } catch (e) {
      const textoErro = e instanceof Error ? e.message : 'Não foi possível carregar os avisos salvos.';
      setErro(textoErro);
      toast(textoErro, 'erro');
    }
  };

  const enviarMensagem = (e: FormEvent) => {
    e.preventDefault();
    const texto = textoChat.trim();
    if (!texto) {
      toast('Digite uma mensagem antes de enviar.', 'erro');
      return;
    }
    try {
      const atual = lerEstado();
      const criadoEm = dataAtual();
      const novaMensagem: MensagemChat = {
        id: novoId(),
        texto,
        autor: usuario.nome,
        perfil: usuario.tipo as PerfilInterno,
        autorId: usuario.id,
        ...(conversaId !== 'equipe' ? { destinatarioId: Number(conversaId) } : {}),
        ...(usuario.tipo === 'MEDICO'
          ? { crm: usuario.crm ? `${usuario.crm}${usuario.crm_uf ? `/${usuario.crm_uf}` : ''}` : 'Não informado' }
          : {}),
        criadoEm,
      };
      const destinatario = contatos.find((contato) => String(contato.id) === conversaId);
      const auditoria = criarRegistroAuditoria(
        usuario,
        'MENSAGEM_ENVIADA',
        `${conversaId === 'equipe' ? 'Enviou mensagem para a equipe' : `Enviou mensagem para ${destinatario?.nome ?? 'usuário interno'}`}: "${texto}"`,
        contatos,
      );
      if (!persistir({ ...atual, mensagens: [...atual.mensagens, novaMensagem], auditoria: [auditoria, ...atual.auditoria] }, 'Mensagem enviada.')) return;
      setTextoChat('');
    } catch (e) {
      const textoErro = e instanceof Error ? e.message : 'Não foi possível carregar as mensagens salvas.';
      setErro(textoErro);
      toast(textoErro, 'erro');
    }
  };

  const removerAviso = (aviso: AvisoComunicacao) => {
    try {
      const atual = lerEstado();
      persistir({
        ...atual,
        avisos: atual.avisos.filter((item) => item.id !== aviso.id),
        auditoria: [criarRegistroAuditoria(usuario, 'AVISO_REMOVIDO', `Removeu o aviso "${aviso.titulo}".`, contatos), ...atual.auditoria],
      }, 'Aviso removido deste navegador.');
    } catch (e) {
      const texto = e instanceof Error ? e.message : 'Não foi possível remover o aviso.';
      setErro(texto);
      toast(texto, 'erro');
    }
  };

  const avisosVisiveis = usuario.tipo === 'ADMIN'
    ? estado.avisos
    : estado.avisos.filter((aviso) => aviso.destinatarios.includes(usuario.tipo as PerfilInterno));
  const conversa = contatos.find((contato) => String(contato.id) === conversaId);
  const mensagensVisiveis = estado.mensagens.filter((item) => {
    if (conversaId === 'equipe') return item.destinatarioId === undefined;
    return (item.autorId === usuario.id && item.destinatarioId === conversa?.id) ||
      (item.autorId === conversa?.id && item.destinatarioId === usuario.id);
  });
  const chaveLeitura = `${usuario.id}:${conversaId}`;
  const idsLidas = new Set(estado.leituras[chaveLeitura] ?? []);
  const naoLidasDaEquipe = estado.mensagens.filter((item) =>
    item.destinatarioId === undefined &&
    item.autorId !== usuario.id &&
    item.autor !== usuario.nome &&
    !idsLidas.has(item.id),
  ).length;
  const naoLidasContato = (contatoId: number) => {
    const lidas = new Set(estado.leituras[`${usuario.id}:${contatoId}`] ?? []);
    return estado.mensagens.filter((item) =>
      item.destinatarioId === usuario.id &&
      item.autorId === contatoId &&
      !lidas.has(item.id),
    ).length;
  };
  const totalNaoLidas = naoLidasDaEquipe + contatos.reduce((total, contato) => total + naoLidasContato(contato.id), 0);
  const idsMensagensDaConversa = mensagensVisiveis
    .filter((item) => item.autorId !== usuario.id && item.autor !== usuario.nome)
    .map((item) => item.id)
    .join('|');
  const usuariosAuditoria = [...new Map(estado.auditoria.map((registro) => [
    `${registro.perfil}:${registro.usuarioId ?? registro.usuario}`,
    { chave: `${registro.perfil}:${registro.usuarioId ?? registro.usuario}`, nome: registro.usuario, perfil: registro.perfil },
  ])).values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const crmsAuditoria = [...new Set([
    ...contatos.map((contato) => contato.crm),
    ...estado.auditoria.map((registro) => registro.crm),
  ].filter((crm): crm is string => Boolean(crm) && crm !== 'Não informado'))].sort();
  const especialidadesAuditoria = [...new Set([
    ...contatos.flatMap((contato) => contato.especialidades?.split(',').map((especialidade) => especialidade.trim()) ?? []),
    ...estado.auditoria.flatMap((registro) => registro.especialidades?.split(',').map((especialidade) => especialidade.trim()) ?? []),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const auditoriaFiltrada = estado.auditoria.filter((registro) => {
    const contato = contatos.find((item) =>
      (registro.usuarioId !== undefined && item.id === registro.usuarioId && item.perfil === registro.perfil) ||
      (registro.usuarioId === undefined && item.nome === registro.usuario && item.perfil === registro.perfil),
    );
    const crm = registro.crm ?? contato?.crm ?? '';
    const especialidades = registro.especialidades ?? contato?.especialidades ?? '';
    const dataRegistro = registro.criadoEm.slice(0, 10);
    const palavra = normalizarBusca(filtroPalavra.trim());
    const textoIndice = normalizarBusca([
      registro.usuario,
      ROTULOS[registro.perfil],
      registro.acao,
      registro.descricao,
      crm,
      especialidades,
      dataHora(registro.criadoEm),
    ].join(' '));
    return (!filtroUsuario || `${registro.perfil}:${registro.usuarioId ?? registro.usuario}` === filtroUsuario) &&
      (!filtroCrm || crm === filtroCrm) &&
      (!filtroEspecialidade || especialidades.split(',').some((item) => item.trim() === filtroEspecialidade)) &&
      (!filtroDataInicial || dataRegistro >= filtroDataInicial) &&
      (!filtroDataFinal || dataRegistro <= filtroDataFinal) &&
      (!palavra || textoIndice.includes(palavra));
  });

  const limparFiltrosAuditoria = () => {
    setFiltroUsuario('');
    setFiltroCrm('');
    setFiltroEspecialidade('');
    setFiltroDataInicial('');
    setFiltroDataFinal('');
    setFiltroPalavra('');
  };

  useEffect(() => {
    if (!chatAberto || !idsMensagensDaConversa) return;
    const ids = idsMensagensDaConversa.split('|');
    const lidas = estado.leituras[chaveLeitura] ?? [];
    if (ids.every((id) => lidas.includes(id))) return;
    const leituras = { ...estado.leituras, [chaveLeitura]: [...new Set([...lidas, ...ids])] };
    try {
      const atualizado = { ...estado, leituras };
      gravarEstado(atualizado);
      setEstado(atualizado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível atualizar as mensagens vistas.');
    }
  }, [chatAberto, chaveLeitura, estado, idsMensagensDaConversa]);

  return (
    <>
      <Cabecalho titulo="Comunicação interna" descricao="Chat da equipe e quadro de avisos por perfil." />
      <Aviso tom="info">
        Chat, avisos e auditoria ficam salvos apenas neste navegador; não são sincronizados entre computadores ou dispositivos.
      </Aviso>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {erroContatos && <Aviso tom="alerta">{erroContatos} Perfis que já acessaram a comunicação neste navegador continuam disponíveis.</Aviso>}

      {usuario.tipo === 'ADMIN' && (
        <section className="painel">
          <h2>Publicar aviso</h2>
          <form className="form" onSubmit={publicar}>
            <Campo rotulo="Título"><input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Campo>
            <Campo rotulo="Mensagem"><textarea rows={4} value={mensagemAviso} onChange={(e) => setMensagemAviso(e.target.value)} /></Campo>
            <fieldset className="grupo">
              <legend>Enviar para</legend>
              <div className="checks">
                {PERFIS.map((perfil) => (
                  <label className="check" key={perfil}>
                    <input
                      type="checkbox"
                      checked={destinatarios.includes(perfil)}
                      onChange={(e) => setDestinatarios((atuais) =>
                        e.target.checked ? [...atuais, perfil] : atuais.filter((atual) => atual !== perfil),
                      )}
                    />
                    {ROTULOS[perfil]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Botao type="submit">Publicar aviso</Botao>
          </form>
        </section>
      )}

      <section className="painel">
        <h2>Quadro de avisos</h2>
        {avisosVisiveis.length === 0 ? (
          <p className="texto-suave">Não há avisos para o seu perfil.</p>
        ) : (
          <ul className="lista">
            {avisosVisiveis.map((aviso) => (
              <li className="lista-item" key={aviso.id}>
                <div>
                  <strong>{aviso.titulo}</strong>
                  <p className="documento-texto">{aviso.mensagem}</p>
                  <p className="texto-suave">Publicado por {aviso.autor} em {dataHora(aviso.criadoEm)}</p>
                  <p className="texto-suave">Destinatários: {aviso.destinatarios.map((perfil) => ROTULOS[perfil]).join(', ')}</p>
                </div>
                {usuario.tipo === 'ADMIN' && <Botao variante="texto" onClick={() => removerAviso(aviso)}>Remover</Botao>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {usuario.tipo === 'ADMIN' && (
        <section className="painel">
          <h2>Auditoria da comunicação</h2>
          <p className="texto-suave">Filtre os registros como em uma planilha: combine critérios ou pesquise palavras-chave.</p>
          {estado.auditoria.length === 0 ? (
            <p className="texto-suave">Ainda não há atividades registradas.</p>
          ) : (
            <>
              <div className="filtros auditoria-filtros">
                <Campo rotulo="Usuário">
                  <select value={filtroUsuario} onChange={(e) => setFiltroUsuario(e.target.value)}>
                    <option value="">Todos</option>
                    {usuariosAuditoria.map((item) => (
                      <option key={item.chave} value={item.chave}>{item.nome} — {ROTULOS[item.perfil]}</option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="CRM">
                  <select value={filtroCrm} onChange={(e) => setFiltroCrm(e.target.value)}>
                    <option value="">Todos</option>
                    {crmsAuditoria.map((crm) => <option key={crm} value={crm}>{crm}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Especialidade">
                  <select value={filtroEspecialidade} onChange={(e) => setFiltroEspecialidade(e.target.value)}>
                    <option value="">Todas</option>
                    {especialidadesAuditoria.map((especialidade) => <option key={especialidade} value={especialidade}>{especialidade}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Data inicial">
                  <input type="date" value={filtroDataInicial} onChange={(e) => setFiltroDataInicial(e.target.value)} />
                </Campo>
                <Campo rotulo="Data final">
                  <input type="date" value={filtroDataFinal} onChange={(e) => setFiltroDataFinal(e.target.value)} />
                </Campo>
                <Campo rotulo="Palavras-chave">
                  <input type="search" placeholder="Nome, ação, mensagem..." value={filtroPalavra} onChange={(e) => setFiltroPalavra(e.target.value)} />
                </Campo>
                <Botao variante="secundario" type="button" onClick={limparFiltrosAuditoria}>Limpar filtros</Botao>
              </div>
              <p className="texto-suave">{auditoriaFiltrada.length} de {estado.auditoria.length} registros</p>
              {auditoriaFiltrada.length === 0 ? (
                <p className="texto-suave">Nenhum registro corresponde aos filtros selecionados.</p>
              ) : (
                <div className="comunicacao-auditoria">
                  {auditoriaFiltrada.map((registro) => {
                    const contato = contatos.find((item) =>
                      (registro.usuarioId !== undefined && item.id === registro.usuarioId && item.perfil === registro.perfil) ||
                      (registro.usuarioId === undefined && item.nome === registro.usuario && item.perfil === registro.perfil),
                    );
                    const crm = registro.crm ?? contato?.crm;
                    const especialidades = registro.especialidades ?? contato?.especialidades;
                    return (
                      <article className="comunicacao-mensagem" key={registro.id}>
                        <header>
                          <strong>{registro.usuario}</strong>
                          <span>{ROTULOS[registro.perfil]}</span>
                          <time dateTime={registro.criadoEm}>{dataHora(registro.criadoEm)}</time>
                        </header>
                        {(crm || especialidades) && (
                          <p className="texto-suave">
                            {crm && `CRM ${crm}`}{crm && especialidades && ' · '}{especialidades}
                          </p>
                        )}
                        <p><strong>{registro.acao.replaceAll('_', ' ')}</strong> — {registro.descricao}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <aside className={`chat-widget ${chatAberto ? 'chat-widget-aberto' : ''}`}>
        {chatAberto && (
          <section className="chat-painel" aria-label="Chat interno">
            <header className="chat-cabecalho">
              <span className="chat-cabecalho-icone" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <path d="M4 5.75A2.75 2.75 0 0 1 6.75 3h10.5A2.75 2.75 0 0 1 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H10l-5 4v-4.5A2.75 2.75 0 0 1 4 13.25v-7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="chat-cabecalho-texto">
                <strong>{conversa?.nome ?? 'Chat da equipe'}</strong>
                <small>
                  {conversa
                    ? `${ROTULOS[conversa.perfil]}${conversa.especialidades ? ` · ${conversa.especialidades}` : ''}${conversa.crm ? ` · CRM ${conversa.crm}` : ''}`
                    : 'Conversa com toda a equipe'}
                </small>
              </span>
              <button className="chat-fechar" type="button" aria-label="Fechar chat" onClick={() => setChatAberto(false)}>×</button>
            </header>
            <div className="chat-corpo">
              <nav className="chat-contatos" aria-label="Contatos internos">
                <button
                  type="button"
                  className={`chat-contato ${conversaId === 'equipe' ? 'ativo' : ''}`}
                  onClick={() => setConversaId('equipe')}
                >
                  <span className="chat-avatar">EQ</span>
                  <span className="chat-contato-dados"><strong>Equipe</strong><small>Chat geral</small></span>
                  {naoLidasDaEquipe > 0 && <span className="chat-nao-lidas" aria-label={`${naoLidasDaEquipe} ${naoLidasDaEquipe === 1 ? 'mensagem não vista' : 'mensagens não vistas'}`}>{naoLidasDaEquipe}</span>}
                </button>
                {contatos.map((contato) => (
                  <button
                    type="button"
                    className={`chat-contato ${conversaId === String(contato.id) ? 'ativo' : ''}`}
                    key={`${contato.perfil}:${contato.id}`}
                    onClick={() => setConversaId(String(contato.id))}
                    title={[ROTULOS[contato.perfil], contato.especialidades, contato.crm ? `CRM ${contato.crm}` : ''].filter(Boolean).join(' · ')}
                  >
                    <span className={`chat-avatar chat-avatar-${contato.perfil.toLowerCase()}`}>{contato.nome.split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase()}</span>
                    <span className="chat-contato-dados">
                      <strong>{contato.nome}</strong>
                      <small>{ROTULOS[contato.perfil]}</small>
                      {contato.perfil === 'MEDICO' && <small>{[contato.especialidades, contato.crm ? `CRM ${contato.crm}` : ''].filter(Boolean).join(' · ') || 'Dados profissionais não informados'}</small>}
                    </span>
                    {naoLidasContato(contato.id) > 0 && (
                      <span className="chat-nao-lidas" aria-label={`${naoLidasContato(contato.id)} ${naoLidasContato(contato.id) === 1 ? 'mensagem não vista' : 'mensagens não vistas'}`}>
                        {naoLidasContato(contato.id)}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <div className="chat-mensagens" aria-live="polite">
              {mensagensVisiveis.length === 0 ? (
                <p className="chat-vazio">Nenhuma mensagem ainda.<br />Comece a conversa.</p>
              ) : (
                mensagensVisiveis.map((item) => {
                  const propria = item.autorId === usuario.id;
                  return (
                    <article className={`chat-balao ${propria ? 'chat-balao-proprio' : ''}`} key={item.id}>
                      <strong>{item.autor}</strong>
                      <span className="chat-perfil">{ROTULOS[item.perfil]}{item.crm ? ` · CRM ${item.crm}` : ''}</span>
                      <p>{item.texto}</p>
                      <time dateTime={item.criadoEm}>{dataHora(item.criadoEm)}</time>
                    </article>
                  );
                })
              )}
              </div>
            </div>
            <form className="chat-compositor" onSubmit={enviarMensagem}>
              <textarea
                aria-label="Mensagem para a equipe"
                placeholder="Escreva uma mensagem..."
                rows={2}
                value={textoChat}
                onChange={(e) => setTextoChat(e.target.value)}
              />
              <button type="submit" aria-label="Enviar mensagem" disabled={!textoChat.trim()}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none">
                  <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          </section>
        )}
        <button
          className="chat-flutuante-botao"
          type="button"
          aria-expanded={chatAberto}
          aria-label={chatAberto ? 'Fechar chat interno' : 'Abrir chat interno'}
          onClick={() => setChatAberto((aberto) => !aberto)}
        >
          <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden fill="none">
            <path d="M4 5.75A2.75 2.75 0 0 1 6.75 3h10.5A2.75 2.75 0 0 1 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H10l-5 4v-4.5A2.75 2.75 0 0 1 4 13.25v-7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          <span>{chatAberto ? 'Fechar chat' : 'Chat da equipe'}</span>
          {!chatAberto && totalNaoLidas > 0 && <span className="chat-contagem">{totalNaoLidas > 99 ? '99+' : totalNaoLidas}</span>}
        </button>
      </aside>
    </>
  );
}
