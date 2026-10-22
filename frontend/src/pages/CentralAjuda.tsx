import { useEffect, useState, type FormEvent } from 'react';
import { useUsuario } from '../auth';
import { data, hora } from '../formato';
import {
  lerSolicitacoes,
  nomeStatusSolicitacao,
  ouvirSolicitacoes,
  salvarSolicitacoes,
  type SolicitacaoAjuda,
} from '../centralAjuda';
import { Botao, Cabecalho, Campo, Tag, useToast, Vazio } from '../components/ui';

const CATEGORIAS = ['Agendamento', 'Atendimento', 'Cadastro', 'Financeiro', 'Outro'];

export function CentralAjuda() {
  const usuario = useUsuario();
  const toast = useToast();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoAjuda[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [assunto, setAssunto] = useState('');
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [mensagem, setMensagem] = useState('');
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const equipe = usuario.tipo === 'RECEPCIONISTA' || usuario.tipo === 'ADMIN';

  const carregar = () => {
    try {
      setSolicitacoes(lerSolicitacoes());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as solicitações.');
    }
  };

  useEffect(() => {
    carregar();
    return ouvirSolicitacoes(carregar);
  }, []);

  const persistir = (novas: SolicitacaoAjuda[]) => {
    try {
      salvarSolicitacoes(novas);
      setSolicitacoes(novas);
      setErro(null);
      return true;
    } catch {
      toast('Não foi possível salvar no armazenamento deste navegador.', 'erro');
      return false;
    }
  };

  const abrirSolicitacao = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const assuntoLimpo = assunto.trim();
    const texto = mensagem.trim();
    if (!assuntoLimpo || !texto) return;
    const agora = new Date().toISOString();
    const id = crypto.randomUUID();
    const nova: SolicitacaoAjuda = {
      id,
      pacienteId: usuario.id,
      pacienteNome: usuario.nome,
      assunto: assuntoLimpo,
      categoria,
      mensagemInicial: texto,
      criadaEm: agora,
      status: 'ABERTA',
      nivel: 'RECEPCAO',
      mensagens: [{
        id: crypto.randomUUID(),
        autorId: usuario.id,
        autorNome: usuario.nome,
        perfil: usuario.tipo,
        texto,
        criadaEm: agora,
      }],
    };
    if (persistir([nova, ...solicitacoes])) {
      setAssunto('');
      setMensagem('');
      window.dispatchEvent(new Event('agenda-saude:formulario-salvo'));
      toast('Solicitação enviada para a recepção.');
    }
  };

  const alterarSolicitacao = (id: string, alterar: (solicitacao: SolicitacaoAjuda) => SolicitacaoAjuda) => {
    return persistir(solicitacoes.map((solicitacao) => solicitacao.id === id ? alterar(solicitacao) : solicitacao));
  };

  const responder = (evento: FormEvent<HTMLFormElement>, solicitacao: SolicitacaoAjuda) => {
    evento.preventDefault();
    const texto = respostas[solicitacao.id]?.trim();
    if (!texto) return;
    const msg = {
      id: crypto.randomUUID(),
      autorId: usuario.id,
      autorNome: usuario.nome,
      perfil: usuario.tipo,
      texto,
      criadaEm: new Date().toISOString(),
    };
    if (alterarSolicitacao(solicitacao.id, (atual) => ({
      ...atual,
      status: 'AGUARDANDO_PACIENTE',
      mensagens: [...atual.mensagens, msg],
    }))) window.dispatchEvent(new Event('agenda-saude:formulario-salvo'));
    setRespostas((atuais) => ({ ...atuais, [solicitacao.id]: '' }));
  };

  const responderPaciente = (evento: FormEvent<HTMLFormElement>, solicitacao: SolicitacaoAjuda) => {
    evento.preventDefault();
    const texto = respostas[solicitacao.id]?.trim();
    if (!texto) return;
    const msg = {
      id: crypto.randomUUID(),
      autorId: usuario.id,
      autorNome: usuario.nome,
      perfil: usuario.tipo,
      texto,
      criadaEm: new Date().toISOString(),
    };
    if (alterarSolicitacao(solicitacao.id, (atual) => ({
      ...atual,
      status: 'ABERTA',
      mensagens: [...atual.mensagens, msg],
    }))) window.dispatchEvent(new Event('agenda-saude:formulario-salvo'));
    setRespostas((atuais) => ({ ...atuais, [solicitacao.id]: '' }));
  };

  const visiveis = solicitacoes
    .filter((solicitacao) => equipe
      ? usuario.tipo === 'ADMIN' ? solicitacao.nivel === 'ADMIN' : solicitacao.nivel === 'RECEPCAO'
      : solicitacao.pacienteId === usuario.id)
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));

  return (
    <>
      <Cabecalho
        titulo="Central de ajuda"
        descricao={equipe
          ? usuario.tipo === 'ADMIN' ? 'Solicitações encaminhadas pela recepção para análise administrativa.' : 'Acompanhe e responda às solicitações enviadas pelos pacientes.'
          : 'Fale com a recepção e acompanhe o andamento das suas solicitações.'}
      />

      {erro && <div className="aviso aviso-erro" role="alert">{erro}</div>}

      {!equipe && (
        <section className="painel">
          <h2>Abrir solicitação</h2>
          <p className="texto-suave">Sua mensagem será encaminhada à recepção. Se necessário, a equipe poderá encaminhá-la ao administrador.</p>
          <form className="form" onSubmit={abrirSolicitacao}>
            <div className="grade-campos">
              <Campo rotulo="Assunto">
                <input value={assunto} onChange={(evento) => setAssunto(evento.target.value)} maxLength={100} required />
              </Campo>
              <Campo rotulo="Categoria">
                <select value={categoria} onChange={(evento) => setCategoria(evento.target.value)}>
                  {CATEGORIAS.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Como podemos ajudar?" largo>
                <textarea value={mensagem} onChange={(evento) => setMensagem(evento.target.value)} rows={4} maxLength={1500} required />
              </Campo>
            </div>
            <Botao type="submit">Enviar à recepção</Botao>
          </form>
        </section>
      )}

      <section className="solicitacoes-secao">
        <header className="secao-cabecalho">
          <h2>{equipe ? usuario.tipo === 'ADMIN' ? 'Encaminhadas ao administrador' : 'Solicitações da recepção' : 'Minhas solicitações'}</h2>
          <span className="tag tag-tom-info">{visiveis.length}</span>
        </header>
        {!visiveis.length ? (
          <Vazio titulo={equipe ? 'Nenhuma solicitação pendente' : 'Você ainda não abriu solicitações'} />
        ) : (
          <ul className="solicitacoes-lista">
            {visiveis.map((solicitacao) => (
              <li className="painel solicitacao-card" key={solicitacao.id}>
                <header className="solicitacao-topo">
                  <div>
                    <span className="solicitacao-categoria">{solicitacao.categoria}</span>
                    <h3>{solicitacao.assunto}</h3>
                    {equipe && <p className="texto-suave">Paciente: {solicitacao.pacienteNome}</p>}
                  </div>
                  <div className="solicitacao-tags">
                    <Tag tom={solicitacao.status === 'RESOLVIDA' ? 'ok' : solicitacao.status === 'EM_ATENDIMENTO' ? 'info' : 'alerta'}>
                      {nomeStatusSolicitacao[solicitacao.status]}
                    </Tag>
                    <Tag tom={solicitacao.nivel === 'ADMIN' ? 'perigo' : 'neutro'}>
                      {solicitacao.nivel === 'ADMIN' ? 'Administrador' : 'Recepção'}
                    </Tag>
                  </div>
                </header>
                <ol className="solicitacao-mensagens" aria-label="Mensagens da solicitação">
                  {solicitacao.mensagens.map((item) => (
                    <li className={`solicitacao-mensagem ${item.perfil === 'PACIENTE' ? 'do-paciente' : ''}`} key={item.id}>
                      <div className="solicitacao-mensagem-meta">
                        <strong>{item.autorNome}</strong>
                        <time dateTime={item.criadaEm}>{data(item.criadaEm)} às {hora(item.criadaEm)}</time>
                      </div>
                      <p>{item.texto}</p>
                    </li>
                  ))}
                </ol>
                {solicitacao.status !== 'RESOLVIDA' && (
                  <form className="solicitacao-resposta" onSubmit={(evento) => equipe ? responder(evento, solicitacao) : responderPaciente(evento, solicitacao)}>
                    <Campo rotulo={equipe ? 'Responder' : 'Enviar mensagem'}>
                      <textarea
                        value={respostas[solicitacao.id] ?? ''}
                        onChange={(evento) => setRespostas((atuais) => ({ ...atuais, [solicitacao.id]: evento.target.value }))}
                        rows={2}
                        maxLength={1500}
                        required
                      />
                    </Campo>
                    <div className="solicitacao-acoes">
                      <Botao type="submit" variante="secundario">{equipe ? 'Enviar resposta' : 'Enviar mensagem'}</Botao>
                      {usuario.tipo === 'RECEPCIONISTA' && solicitacao.nivel === 'RECEPCAO' && (
                        <Botao type="button" variante="texto" onClick={() => {
                          alterarSolicitacao(solicitacao.id, (atual) => ({
                            ...atual,
                            nivel: 'ADMIN',
                            status: 'ABERTA',
                            mensagens: [...atual.mensagens, {
                              id: crypto.randomUUID(),
                              autorId: usuario.id,
                              autorNome: usuario.nome,
                              perfil: usuario.tipo,
                              texto: 'Solicitação encaminhada ao administrador para análise.',
                              criadaEm: new Date().toISOString(),
                            }],
                          }));
                          toast('Solicitação encaminhada ao administrador.');
                        }}>
                          Encaminhar ao administrador
                        </Botao>
                      )}
                    </div>
                  </form>
                )}
                {equipe && (
                  <div className="solicitacao-acoes">
                    <Botao type="button" variante="texto" onClick={() => alterarSolicitacao(solicitacao.id, (atual) => ({
                      ...atual,
                      status: atual.status === 'RESOLVIDA' ? 'ABERTA' : 'RESOLVIDA',
                    }))}>
                      {solicitacao.status === 'RESOLVIDA' ? 'Reabrir solicitação' : 'Marcar como resolvida'}
                    </Botao>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="texto-suave ajuda-local">As solicitações ficam salvas apenas neste navegador, pois esta etapa foi implementada somente no frontend.</p>
    </>
  );
}
