import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Consulta, type Especialidade, type Medico } from '../api';
import { SeletorHorario } from '../components/SeletorHorario';
import { Aviso, Botao, Cabecalho, Carregando, useAcao } from '../components/ui';
import { dataHora } from '../formato';
import { useCarregar } from '../hooks';

// Consultar especialidades, médicos e horários; agendar consulta (ou confirmar retorno sugerido)
export function Agendar() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const retorno = params.get('retorno') === '1';
  const especialidades = useCarregar(() => api.get<Especialidade[]>('/especialidades'));
  const medicos = useCarregar(() => api.get<Medico[]>('/medicos'));
  const [esp, setEsp] = useState<number | null>(null);
  const [medicoId, setMedicoId] = useState<string | null>(params.get('medico'));
  const [horario, setHorario] = useState<string | null>(null);
  const [executar, executando] = useAcao();

  // veio de um link (vaga aberta, retorno): pré-seleciona a especialidade do médico
  useEffect(() => {
    if (medicoId && medicos.dados && !esp) {
      const m = medicos.dados.find((x) => x.id === medicoId);
      if (m?.especialidade_ids) setEsp(Number(m.especialidade_ids.split(',')[0]));
    }
  }, [medicoId, medicos.dados, esp]);

  const medicosDaEsp = medicos.dados?.filter((m) => esp && m.especialidade_ids?.split(',').map(Number).includes(esp)) ?? [];
  const medico = medicos.dados?.find((m) => m.id === medicoId);

  const confirmar = async () => {
    const r = await executar(
      () => api.post<Consulta>('/consultas', { medico_id: medicoId, data_hora: horario, tipo: retorno ? 'RETORNO' : 'NORMAL' }),
      'Consulta agendada.',
    );
    if (r) navegar('/consultas');
  };

  if (especialidades.carregando || medicos.carregando) return <Carregando />;

  return (
    <>
      <Cabecalho titulo={retorno ? 'Agendar retorno' : 'Agendar consulta'} descricao={retorno ? 'Escolha um horário dentro do prazo indicado pelo médico.' : undefined} />
      <ol className="passos">
        <li className="passo">
          <h2>Especialidade</h2>
          <div className="opcoes">
            {especialidades.dados?.map((e) => (
              <button key={e.id} type="button" className="opcao" aria-pressed={esp === e.id} onClick={() => { setEsp(e.id); setMedicoId(null); setHorario(null); }}>
                {e.nome}
              </button>
            ))}
          </div>
        </li>

        {esp && (
          <li className="passo">
            <h2>Médico</h2>
            <div className="opcoes opcoes-medico">
              {medicosDaEsp.map((m) => (
                <button key={m.id} type="button" className="opcao opcao-medico" aria-pressed={medicoId === m.id} onClick={() => { setMedicoId(m.id); setHorario(null); }}>
                  <span className="opcao-titulo">{m.nome}</span>
                  <span className="opcao-sub">{m.especialidades}</span>
                  <span className="opcao-sub">CRM {m.crm}/{m.crm_uf}</span>
                </button>
              ))}
            </div>
            <p className="texto-suave">
              Não achou horário? <Link to="/lista-espera">Entre na lista de espera</Link> e avisamos quando abrir uma vaga.
            </p>
          </li>
        )}

        {medicoId && (
          <li className="passo">
            <h2>Dia e horário</h2>
            <SeletorHorario medicoId={medicoId} valor={horario} aoEscolher={setHorario} dataInicial={params.get('data')} />
          </li>
        )}

        {horario && medico && (
          <li className="passo passo-final">
            <h2>Confirmar</h2>
            <Aviso tom="info">
              {retorno ? 'Retorno' : 'Consulta'} com <strong>{medico.nome}</strong> em <strong>{dataHora(horario)}</strong>. No dia, faça o check-in pelo sistema ao chegar.
            </Aviso>
            <Botao carregando={executando} onClick={confirmar}>Confirmar agendamento</Botao>
          </li>
        )}
      </ol>
    </>
  );
}
