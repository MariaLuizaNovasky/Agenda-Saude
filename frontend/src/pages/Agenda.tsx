import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs, type Consulta, type Medico, type Paciente } from '../api';
import { useUsuario } from '../auth';
import { ModalCancelar, ModalReagendar } from '../components/AcoesConsulta';
import { BuscaPaciente } from '../components/BuscaPaciente';
import { SeletorHorario } from '../components/SeletorHorario';
import { Abas, Botao, Cabecalho, Campo, Carregando, Modal, StatusConsultaTag, useAcao, Vazio } from '../components/ui';
import { cpf, dataHora, diaExtenso, hojeISO, hora, minutosDesde, relativoDia, somarDias, TIPO } from '../formato';
import { useAgora, useCarregar, useEventos } from '../hooks';

// Recepção: agenda do dia (check-in, faltas, remarcação, encaixe). Médico: a própria agenda.
export function Agenda() {
  const u = useUsuario();
  const recepcao = u.tipo !== 'MEDICO';
  const [dia, setDia] = useState(hojeISO());
  const [medicoId, setMedicoId] = useState('');
  const medicos = useCarregar(() => (recepcao ? api.get<Medico[]>('/medicos') : Promise.resolve([])));
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Consulta[]>(`/consultas${qs({ data: dia, medico_id: medicoId })}`), [dia, medicoId]);
  useEventos(['agenda', 'fila'], recarregar);
  const agora = useAgora();
  const [executar, executando] = useAcao();
  const [nova, setNova] = useState(false);
  const [remarcar, setRemarcar] = useState<Consulta | null>(null);
  const [cancelar, setCancelar] = useState<Consulta | null>(null);
  const hoje = dia === hojeISO();

  const acao = (c: Consulta, caminho: string, msg: string) => executar(() => api.post(`/consultas/${c.id}/${caminho}`), msg).then(recarregar);
  const ativas = dados?.filter((c) => !['CANCELADA'].includes(c.status)).length ?? 0;

  return (
    <>
      <Cabecalho
        titulo={recepcao ? 'Agenda' : 'Minha agenda'}
        descricao={`${relativoDia(dia) === diaExtenso(dia) ? '' : relativoDia(dia) + ', '}${diaExtenso(dia)}. ${ativas} ${ativas === 1 ? 'consulta' : 'consultas'}.`}
        acoes={recepcao && <Botao onClick={() => setNova(true)}>Nova consulta</Botao>}
      />
      <div className="filtros">
        <div className="navegar-dia">
          <Botao variante="secundario" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior">‹</Botao>
          <input type="date" aria-label="Dia" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />
          <Botao variante="secundario" onClick={() => setDia(somarDias(dia, 1))} aria-label="Próximo dia">›</Botao>
          {!hoje && <Botao variante="texto" onClick={() => setDia(hojeISO())}>Hoje</Botao>}
        </div>
        {recepcao && (
          <select aria-label="Médico" value={medicoId} onChange={(e) => setMedicoId(e.target.value)}>
            <option value="">Todos os médicos</option>
            {medicos.dados?.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        )}
      </div>

      {carregando ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhuma consulta neste dia" />
      ) : (
        <ol className="dia" aria-label="Consultas do dia por horário">
          {porHora(dados).map(([h, itens]) => (
            <li key={h} className={`dia-hora ${hoje && h.slice(0, 2) === String(agora.getHours()).padStart(2, '0') ? 'dia-hora-agora' : ''}`}>
              <time>{h}</time>
              <ul className="dia-itens">
                {itens.map((c) => {
                  const passou = minutosDesde(c.data_hora, agora) > 0;
                  const apagada = c.status === 'CANCELADA' || c.status === 'FALTOU';
                  return (
                    <li key={c.id} className={`dia-item ${apagada ? 'dia-item-apagado' : ''}`} data-status={c.status}>
                      <div className="dia-quem">
                        <div className="dia-nome">
                          <strong>{c.paciente_nome}</strong>
                          {hora(c.data_hora) !== h && <span className="dia-meta">{hora(c.data_hora)}</span>}
                          {c.tipo !== 'NORMAL' && <span className="dia-tipo">{TIPO[c.tipo]}</span>}
                          <StatusConsultaTag status={c.status} />
                          {c.atraso_min > 0 && ['AGENDADA', 'CONFIRMADA', 'EM_ESPERA'].includes(c.status) && <span className="texto-alerta">+{c.atraso_min} min</span>}
                        </div>
                        <span className="dia-meta">
                          {recepcao ? <>com <b>{c.medico_nome}</b>, tel. {c.paciente_telefone}</> : <>CPF {cpf(c.paciente_cpf)}</>}
                        </span>
                      </div>
                      <div className="dia-acoes">
                        {recepcao ? (
                          <>
                            {hoje && ['AGENDADA', 'CONFIRMADA'].includes(c.status) && (
                              <Botao carregando={executando} onClick={() => acao(c, 'confirmar-presenca', `${c.paciente_nome} entrou na fila.`)}>Confirmar presença</Botao>
                            )}
                            {['AGENDADA', 'CONFIRMADA'].includes(c.status) && <Botao variante="secundario" onClick={() => setRemarcar(c)}>Remarcar</Botao>}
                            {passou && ['AGENDADA', 'CONFIRMADA'].includes(c.status) && (
                              <Botao variante="texto" carregando={executando} onClick={() => acao(c, 'faltou', 'Falta registrada.')}>Faltou</Botao>
                            )}
                            {['AGENDADA', 'CONFIRMADA', 'EM_ESPERA'].includes(c.status) && <Botao variante="texto" onClick={() => setCancelar(c)}>Cancelar</Botao>}
                          </>
                        ) : (
                          ['EM_ESPERA', 'EM_ATENDIMENTO', 'FINALIZADA'].includes(c.status) && (
                            <Link className="btn btn-secundario" to={`/atendimento/${c.id}`}>{c.status === 'FINALIZADA' ? 'Ver atendimento' : 'Abrir'}</Link>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {recepcao && <ModalNovaConsulta aberto={nova} dia={dia} aoFechar={() => setNova(false)} aoConcluir={() => { setNova(false); recarregar(); }} medicos={medicos.dados ?? []} />}
      <ModalReagendar consulta={remarcar} aoFechar={() => setRemarcar(null)} aoConcluir={() => { setRemarcar(null); recarregar(); }} />
      <ModalCancelar consulta={cancelar} aoFechar={() => setCancelar(null)} aoConcluir={() => { setCancelar(null); recarregar(); }} />
    </>
  );
}

/** Agrupa as consultas pela hora cheia (08:00, 09:00...), mantendo a ordem. */
function porHora(lista: Consulta[]): [string, Consulta[]][] {
  const grupos = new Map<string, Consulta[]>();
  for (const c of lista) {
    const h = `${hora(c.data_hora).slice(0, 2)}:00`;
    grupos.set(h, [...(grupos.get(h) ?? []), c]);
  }
  return [...grupos.entries()];
}

function ModalNovaConsulta({ aberto, dia, medicos, aoFechar, aoConcluir }: { aberto: boolean; dia: string; medicos: Medico[]; aoFechar: () => void; aoConcluir: () => void }) {
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [medicoId, setMedicoId] = useState<number | null>(null);
  const [modo, setModo] = useState<'NORMAL' | 'RETORNO' | 'ENCAIXE'>('NORMAL');
  const [horario, setHorario] = useState<string | null>(null);
  const [encHora, setEncHora] = useState('');
  const [encDia, setEncDia] = useState(dia);
  const [executar, executando] = useAcao();

  const limpar = () => { setPaciente(null); setMedicoId(null); setHorario(null); setEncHora(''); setModo('NORMAL'); };
  const dh = modo === 'ENCAIXE' ? (encHora ? `${encDia}T${encHora}` : null) : horario;

  return (
    <Modal aberto={aberto} aoFechar={() => { limpar(); aoFechar(); }} titulo="Nova consulta" largo>
      <div className="form">
        <Campo rotulo="Paciente">
          <BuscaPaciente valor={paciente} aoEscolher={setPaciente} />
        </Campo>
        <Campo rotulo="Médico">
          <select value={medicoId ?? ''} onChange={(e) => { setMedicoId(e.target.value ? Number(e.target.value) : null); setHorario(null); }}>
            <option value="">Escolha</option>
            {medicos.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.especialidades})</option>)}
          </select>
        </Campo>
        {medicoId && (
          <>
            <Abas
              valor={modo}
              aoMudar={(v) => { setModo(v); setHorario(null); }}
              opcoes={[{ valor: 'NORMAL', rotulo: 'Consulta' }, { valor: 'RETORNO', rotulo: 'Retorno' }, { valor: 'ENCAIXE', rotulo: 'Encaixe' }]}
            />
            {modo === 'ENCAIXE' ? (
              <div className="grade-campos">
                <Campo rotulo="Dia"><input type="date" min={hojeISO()} value={encDia} onChange={(e) => setEncDia(e.target.value)} /></Campo>
                <Campo rotulo="Hora" dica="O encaixe entra entre os horários da agenda."><input type="time" value={encHora} onChange={(e) => setEncHora(e.target.value)} /></Campo>
              </div>
            ) : (
              <SeletorHorario medicoId={medicoId} valor={horario} aoEscolher={setHorario} dataInicial={dia} />
            )}
          </>
        )}
        <div className="modal-acoes">
          <Botao variante="secundario" onClick={() => { limpar(); aoFechar(); }}>Voltar</Botao>
          <Botao
            disabled={!paciente || !medicoId || !dh}
            carregando={executando}
            onClick={async () => {
              const r = await executar(
                () => api.post('/consultas', { paciente_id: paciente!.id, medico_id: medicoId, data_hora: dh, tipo: modo }),
                `${TIPO[modo]} marcado para ${dataHora(dh)}.`,
              );
              if (r) { limpar(); aoConcluir(); }
            }}
          >
            {dh ? `Marcar em ${dataHora(dh)}` : 'Escolha o horário'}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
