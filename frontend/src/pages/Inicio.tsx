import { Link } from 'react-router-dom';
import { api, type Consulta, type Exame } from '../api';
import { useUsuario } from '../auth';
import { Bolinha, Estrela, SetaDiagonal } from '../components/Icones';
import { Botao, Carregando, StatusConsultaTag, useAcao } from '../components/ui';
import { data, hojeISO, hora, primeiroNome, relativoDia, TIPO } from '../formato';
import { useCarregar, useEventos } from '../hooks';

const iniciais = (nome: string) =>
  nome.replace(/^Dra?\.\s+/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function Inicio() {
  const u = useUsuario();
  const consultas = useCarregar(() => api.get<Consulta[]>('/consultas?futuras=1&status=AGENDADA,CONFIRMADA,EM_ESPERA,EM_ATENDIMENTO'));
  const retornos = useCarregar(() => api.get<Exame[]>('/retornos'));
  const [executar, executando] = useAcao();
  useEventos(['fila', 'agenda'], consultas.recarregar);

  const proxima = consultas.dados?.[0];
  const outras = consultas.dados?.slice(1, 4) ?? [];
  const hoje = proxima && proxima.data_hora.slice(0, 10) === hojeISO();
  const retorno = retornos.dados?.[0];

  if (consultas.carregando) return <Carregando />;

  return (
    <>
      <section className="hero">
        <div className="hero-texto">
          <h1 className="hero-titulo">Olá, {primeiroNome(u.nome)}</h1>
          <p className="hero-sub">
            {!proxima
              ? 'Você não tem consultas marcadas. Escolha a especialidade e o melhor horário para você.'
              : hoje
                ? proxima.status === 'AGENDADA'
                  ? `Sua consulta com ${proxima.medico_nome} é hoje. Ao chegar na clínica, faça o check-in por aqui.`
                  : 'Você já está na fila de hoje. Acompanhe sua posição em tempo real.'
                : `Sua próxima consulta é com ${proxima.medico_nome}, ${relativoDia(proxima.data_hora).toLowerCase()}.`}
          </p>

          <div className="hero-acoes">
            {proxima && hoje && proxima.status === 'AGENDADA' && (
              <Botao carregando={executando} onClick={() => executar(() => api.post(`/consultas/${proxima.id}/checkin`), 'Check-in feito. A recepção vai confirmar sua presença.').then(consultas.recarregar)}>
                Fazer check-in
              </Botao>
            )}
            {proxima && hoje && proxima.status !== 'AGENDADA' && <Link className="btn btn-primario" to="/fila">Ver minha posição na fila</Link>}
            {proxima && !hoje && <Link className="btn btn-primario" to="/consultas">Remarcar ou cancelar</Link>}
            <Link className={`btn ${proxima ? 'btn-secundario' : 'btn-primario'}`} to="/agendar">Agendar consulta</Link>
          </div>

          {proxima && (
            <dl className="numeros">
              <div><dd>{hora(proxima.data_hora)}</dd><dt>{relativoDia(proxima.data_hora)}</dt></div>
              <div><dd>{hoje && proxima.atraso_min > 0 ? `${proxima.atraso_min} min` : '0 min'}</dd><dt>de atraso</dt></div>
              <div><dd>{retornos.dados?.length ?? 0}</dd><dt>{retornos.dados?.length === 1 ? 'retorno a marcar' : 'retornos a marcar'}</dt></div>
            </dl>
          )}
        </div>

        <div className="colagem colagem-inicio">
          <Estrela style={{ left: -8, top: '46%' }} />
          <Estrela tamanho={16} style={{ right: 4, bottom: 4 }} />
          <Bolinha cor="var(--lilas)" tamanho={14} style={{ right: 6, top: '34%' }} />
          <Bolinha cor="var(--ceu)" tamanho={22} style={{ right: '30%', bottom: -4 }} />

          {proxima ? (
            <div className="bloco bloco-ceu bloco-hora">
              <span className="bloco-rotulo">{relativoDia(proxima.data_hora)}</span>
              <span className="bloco-grande">{hora(proxima.data_hora)}</span>
              <span className="bloco-titulo">{TIPO[proxima.tipo]} com {proxima.medico_nome}</span>
              <span><StatusConsultaTag status={proxima.status} /></span>
              {proxima.atraso_min > 0 && hoje && <span className="texto-alerta">Atraso informado: cerca de {proxima.atraso_min} min.</span>}
              <Link className="bloco-seta" style={{ right: -14, top: -14 }} to={hoje ? '/fila' : '/consultas'} aria-label={hoje ? 'Ver fila de atendimento' : 'Ver minhas consultas'}>
                <SetaDiagonal />
              </Link>
            </div>
          ) : (
            <div className="bloco bloco-ceu bloco-hora">
              <span className="bloco-rotulo">Nenhuma consulta</span>
              <span className="bloco-grande">--:--</span>
              <span className="bloco-titulo">Quando você marcar, o horário aparece aqui.</span>
            </div>
          )}

          <div className="bloco bloco-lilas bloco-medico">
            {proxima ? (
              <>
                <span className="monograma" aria-hidden>{iniciais(proxima.medico_nome)}</span>
                <span className="bloco-rotulo" style={{ textAlign: 'center' }}>{proxima.especialidades}</span>
              </>
            ) : (
              <span className="monograma" aria-hidden>{iniciais(u.nome)}</span>
            )}
          </div>

          <div className="bloco bloco-salvia bloco-retorno">
            {retorno ? (
              <>
                <span className="bloco-rotulo">Retorno até {data(retorno.data_limite_retorno)}</span>
                <span className="bloco-titulo">{retorno.tipo} pronto</span>
                <Link to={`/agendar?medico=${retorno.medico_id}&retorno=1`}>Agendar retorno</Link>
              </>
            ) : (
              <>
                <span className="bloco-rotulo">Exames e receitas</span>
                <span className="bloco-titulo">Tudo guardado no seu histórico</span>
                <Link to="/historico">Abrir histórico</Link>
              </>
            )}
          </div>

          <Link className="bloco bloco-pessego bloco-pilula" to="/consultas">
            <span className="argolas" aria-hidden><i /><i /><i /></span>
            <span className="bloco-titulo">{consultas.dados?.length ?? 0} {consultas.dados?.length === 1 ? 'consulta marcada' : 'consultas marcadas'}</span>
          </Link>
        </div>
      </section>

      {(outras.length > 0 || (retornos.dados?.length ?? 0) > 1) && (
        <div className="colunas">
          {outras.length > 0 && (
            <section className="painel">
              <h2>Próximas consultas</h2>
              <ul className="lista">
                {outras.map((c) => (
                  <li key={c.id} className="lista-item">
                    <div>
                      <strong>{relativoDia(c.data_hora)}, {hora(c.data_hora)}</strong> com {c.medico_nome}
                    </div>
                    <StatusConsultaTag status={c.status} />
                  </li>
                ))}
              </ul>
              <Link to="/consultas">Ver todas as consultas</Link>
            </section>
          )}
          {(retornos.dados?.length ?? 0) > 1 && (
            <section className="painel">
              <h2>Retornos a agendar</h2>
              <ul className="lista">
                {retornos.dados!.map((r) => (
                  <li key={r.id} className="lista-item">
                    <div>
                      <strong>{r.tipo}</strong> com resultado pronto. Volte a {r.medico_nome} até <strong>{data(r.data_limite_retorno)}</strong>.
                    </div>
                    <Link className="btn btn-secundario" to={`/agendar?medico=${r.medico_id}&retorno=1`}>Agendar retorno</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
