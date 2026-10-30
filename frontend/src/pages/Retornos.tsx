import { useState } from 'react';
import { api, type Exame } from '../api';
import { useUsuario } from '../auth';
import { SeletorHorario } from '../components/SeletorHorario';
import { Botao, Cabecalho, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { cpf, data, dataHora, hojeISO } from '../formato';
import { useCarregar, useEventos } from '../hooks';

// Acompanhar retornos pendentes e agendar/remarcar
export function Retornos() {
  const u = useUsuario();
  const recepcao = u.tipo !== 'MEDICO';
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Exame[]>('/retornos'));
  useEventos(['agenda'], recarregar);
  const [agendar, setAgendar] = useState<Exame | null>(null);
  const [horario, setHorario] = useState<string | null>(null);
  const [executar, executando] = useAcao();
  const hoje = hojeISO();

  return (
    <>
      <Cabecalho titulo="Retornos pendentes" descricao="Exames com resultado pronto e prazo de retorno definido pelo médico, ainda sem retorno marcado." />
      {carregando ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhum retorno pendente" />
      ) : (
        <table className="tabela">
          <thead><tr><th>Paciente</th><th>Exame</th><th>Médico</th><th>Resultado em</th><th>Retorno até</th><th /></tr></thead>
          <tbody>
            {dados.map((r) => {
              const atrasado = r.data_limite_retorno! < hoje;
              return (
                <tr key={r.id}>
                  <td data-rotulo="Paciente"><strong>{r.paciente_nome}</strong><div className="texto-suave">{cpf(r.paciente_cpf)}</div></td>
                  <td data-rotulo="Exame">{r.tipo}</td>
                  <td data-rotulo="Médico">{r.medico_nome}</td>
                  <td data-rotulo="Resultado em">{data(r.data_resultado)}</td>
                  <td data-rotulo="Retorno até">
                    {data(r.data_limite_retorno)} {atrasado && <Tag tom="perigo">Prazo vencido</Tag>}
                  </td>
                  <td className="celula-acoes">{recepcao && <Botao onClick={() => setAgendar(r)}>Agendar retorno</Botao>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Modal aberto={!!agendar} aoFechar={() => { setAgendar(null); setHorario(null); }} titulo={`Retorno de ${agendar?.paciente_nome ?? ''}`} largo>
        {agendar && (
          <>
            <p className="texto-suave">Com {agendar.medico_nome}, até {data(agendar.data_limite_retorno)}.</p>
            <SeletorHorario medicoId={agendar.medico_id} valor={horario} aoEscolher={setHorario} />
            {horario && horario.slice(0, 10) > agendar.data_limite_retorno! && <p className="texto-alerta">Este horário fica depois do prazo indicado pelo médico.</p>}
            <div className="modal-acoes">
              <Botao variante="secundario" onClick={() => { setAgendar(null); setHorario(null); }}>Voltar</Botao>
              <Botao
                disabled={!horario}
                carregando={executando}
                onClick={async () => {
                  const r = await executar(
                    () => api.post('/consultas', { paciente_id: agendar.paciente_id, medico_id: agendar.medico_id, data_hora: horario, tipo: 'RETORNO' }),
                    `Retorno marcado para ${dataHora(horario)}. O paciente foi avisado.`,
                  );
                  if (r) { setAgendar(null); setHorario(null); recarregar(); }
                }}
              >
                {horario ? `Marcar retorno em ${dataHora(horario)}` : 'Escolha o horário'}
              </Botao>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
