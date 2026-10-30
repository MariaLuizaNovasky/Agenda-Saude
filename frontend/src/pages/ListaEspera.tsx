import { useState, type FormEvent } from 'react';
import { api, type Especialidade, type ItemListaEspera, type Medico, type Paciente } from '../api';
import { useUsuario } from '../auth';
import { BuscaPaciente } from '../components/BuscaPaciente';
import { SeletorHorario } from '../components/SeletorHorario';
import { Abas, Botao, Cabecalho, Campo, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { data, dataHora, hojeISO, PRIORIDADE, relativoDia } from '../formato';
import { useCarregar } from '../hooks';

const TOM_PRIORIDADE = ['neutro', 'info', 'perigo'] as const;

// Solicitar encaixe / entrar na lista de espera (paciente) e gerenciar encaixes (recepção)
export function ListaEspera() {
  const u = useUsuario();
  const recepcao = u.tipo !== 'PACIENTE';
  const lista = useCarregar(() => api.get<ItemListaEspera[]>('/lista-espera'));
  const especialidades = useCarregar(() => api.get<Especialidade[]>('/especialidades'));
  const [novo, setNovo] = useState(false);
  const [encaixar, setEncaixar] = useState<ItemListaEspera | null>(null);
  const [executar, executando] = useAcao();

  return (
    <>
      <Cabecalho
        titulo="Lista de espera"
        descricao={
          recepcao
            ? 'Pedidos por ordem de prioridade e chegada. Quando uma consulta é cancelada, o primeiro da especialidade é avisado.'
            : 'Quando abrir uma vaga na especialidade, você recebe um aviso para agendar.'
        }
        acoes={<Botao onClick={() => setNovo(true)}>{recepcao ? 'Incluir paciente' : 'Entrar na lista'}</Botao>}
      />
      {lista.carregando ? (
        <Carregando />
      ) : !lista.dados?.length ? (
        <Vazio titulo={recepcao ? 'Nenhum pedido aguardando' : 'Você não está em nenhuma lista de espera'} />
      ) : (
        <table className="tabela">
          <thead>
            <tr>
              {recepcao && <th>Paciente</th>}
              <th>Especialidade</th>
              <th>Pedido em</th>
              <th>Prioridade</th>
              <th>Observação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.dados.map((i) => (
              <tr key={i.id}>
                {recepcao && (
                  <td data-rotulo="Paciente">
                    <strong>{i.paciente_nome}</strong>
                    <div className="texto-suave">{i.paciente_telefone}</div>
                  </td>
                )}
                <td data-rotulo="Especialidade">{i.especialidade_nome}</td>
                <td data-rotulo="Pedido em">{relativoDia(i.data_solicitacao)}</td>
                <td data-rotulo="Prioridade">
                  {recepcao ? (
                    <select
                      aria-label="Prioridade"
                      value={i.prioridade}
                      onChange={(e) => executar(() => api.put(`/lista-espera/${i.id}`, { prioridade: Number(e.target.value) }), 'Prioridade alterada.').then(lista.recarregar)}
                    >
                      {PRIORIDADE.map((p, n) => <option key={p} value={n}>{p}</option>)}
                    </select>
                  ) : (
                    <Tag tom={TOM_PRIORIDADE[i.prioridade]}>{PRIORIDADE[i.prioridade]}</Tag>
                  )}
                </td>
                <td data-rotulo="Observação">{i.observacao ?? '—'}</td>
                <td className="celula-acoes">
                  {recepcao && <Botao onClick={() => setEncaixar(i)}>Agendar</Botao>}
                  <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.del(`/lista-espera/${i.id}`), 'Pedido removido da lista.').then(lista.recarregar)}>
                    {recepcao ? 'Remover' : 'Sair da lista'}
                  </Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ModalNovoPedido aberto={novo} recepcao={recepcao} especialidades={especialidades.dados ?? []} aoFechar={() => setNovo(false)} aoConcluir={() => { setNovo(false); lista.recarregar(); }} />
      <ModalEncaixe item={encaixar} aoFechar={() => setEncaixar(null)} aoConcluir={() => { setEncaixar(null); lista.recarregar(); }} />
    </>
  );
}

function ModalNovoPedido({ aberto, recepcao, especialidades, aoFechar, aoConcluir }: { aberto: boolean; recepcao: boolean; especialidades: Especialidade[]; aoFechar: () => void; aoConcluir: () => void }) {
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [esp, setEsp] = useState('');
  const [prioridade, setPrioridade] = useState(0);
  const [obs, setObs] = useState('');
  const [executar, executando] = useAcao();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = await executar(
      () => api.post('/lista-espera', { especialidade_id: Number(esp), paciente_id: paciente?.id, prioridade, observacao: obs || undefined }),
      recepcao ? 'Paciente incluído na lista de espera.' : 'Você entrou na lista de espera.',
    );
    if (r) { setPaciente(null); setEsp(''); setObs(''); setPrioridade(0); aoConcluir(); }
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={recepcao ? 'Incluir na lista de espera' : 'Entrar na lista de espera'}>
      <form className="form" onSubmit={enviar}>
        {recepcao && (
          <Campo rotulo="Paciente">
            <BuscaPaciente valor={paciente} aoEscolher={setPaciente} />
          </Campo>
        )}
        <Campo rotulo="Especialidade">
          <select required value={esp} onChange={(e) => setEsp(e.target.value)}>
            <option value="">Escolha</option>
            {especialidades.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        {recepcao && (
          <Campo rotulo="Prioridade">
            <select value={prioridade} onChange={(e) => setPrioridade(Number(e.target.value))}>
              {PRIORIDADE.map((p, n) => <option key={p} value={n}>{p}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Observação (opcional)" dica="Ex.: prefere manhã, sintomas, urgência.">
          <textarea rows={2} maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} />
        </Campo>
        <div className="modal-acoes">
          <Botao type="button" variante="secundario" onClick={aoFechar}>Voltar</Botao>
          <Botao type="submit" carregando={executando} disabled={recepcao && !paciente}>{recepcao ? 'Incluir' : 'Entrar na lista'}</Botao>
        </div>
      </form>
    </Modal>
  );
}

/** Recepção agenda o pedido: num horário livre ou como encaixe no dia. */
function ModalEncaixe({ item, aoFechar, aoConcluir }: { item: ItemListaEspera | null; aoFechar: () => void; aoConcluir: () => void }) {
  const medicos = useCarregar(() => (item ? api.get<Medico[]>(`/medicos?especialidade_id=${item.especialidade_id}`) : Promise.resolve([])), [item?.id]);
  const [medicoId, setMedicoId] = useState<string | null>(null);
  const [modo, setModo] = useState<'vaga' | 'encaixe'>('vaga');
  const [horario, setHorario] = useState<string | null>(null);
  const [encDia, setEncDia] = useState(hojeISO());
  const [encHora, setEncHora] = useState('');
  const [executar, executando] = useAcao();

  const fechar = () => { setMedicoId(null); setHorario(null); setEncHora(''); aoFechar(); };
  const dh = modo === 'vaga' ? horario : encHora ? `${encDia}T${encHora}` : null;

  return (
    <Modal aberto={!!item} aoFechar={fechar} titulo={`Agendar ${item?.paciente_nome ?? ''}`} largo>
      {item && (
        <div className="form">
          <p className="texto-suave">{item.especialidade_nome}, pedido de {data(item.data_solicitacao)}. {item.observacao}</p>
          <Campo rotulo="Médico">
            <select value={medicoId ?? ''} onChange={(e) => { setMedicoId(e.target.value || null); setHorario(null); }}>
              <option value="">Escolha</option>
              {medicos.dados?.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Campo>
          {medicoId && (
            <>
              <Abas valor={modo} aoMudar={setModo} opcoes={[{ valor: 'vaga', rotulo: 'Horário livre' }, { valor: 'encaixe', rotulo: 'Encaixe' }]} />
              {modo === 'vaga' ? (
                <SeletorHorario medicoId={medicoId} valor={horario} aoEscolher={setHorario} />
              ) : (
                <div className="grade-campos">
                  <Campo rotulo="Dia"><input type="date" min={hojeISO()} value={encDia} onChange={(e) => setEncDia(e.target.value)} /></Campo>
                  <Campo rotulo="Hora" dica="Encaixes entram entre os horários da agenda."><input type="time" value={encHora} onChange={(e) => setEncHora(e.target.value)} /></Campo>
                </div>
              )}
            </>
          )}
          <div className="modal-acoes">
            <Botao variante="secundario" onClick={fechar}>Voltar</Botao>
            <Botao
              disabled={!medicoId || !dh}
              carregando={executando}
              onClick={async () => {
                const r = await executar(
                  () => api.post('/consultas', { medico_id: medicoId, data_hora: dh, paciente_id: item.paciente_id, tipo: modo === 'encaixe' ? 'ENCAIXE' : 'NORMAL', lista_espera_id: item.id }),
                  `${modo === 'encaixe' ? 'Encaixe' : 'Consulta'} marcado para ${dataHora(dh)}. O paciente foi avisado.`,
                );
                if (r) { setMedicoId(null); setHorario(null); aoConcluir(); }
              }}
            >
              {dh ? `Marcar ${modo === 'encaixe' ? 'encaixe' : 'consulta'} em ${dataHora(dh)}` : 'Escolha o horário'}
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  );
}
