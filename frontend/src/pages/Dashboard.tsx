import { useState } from 'react';
import { api } from '../api';
import { Cabecalho, Carregando } from '../components/ui';
import { diaExtenso, dinheiro, hojeISO, paraData } from '../formato';
import { useCarregar, useEventos } from '../hooks';

interface Dados {
  data: string;
  dia: {
    total: number; agendadas: number; aguardando: number; em_atendimento: number; finalizadas: number;
    canceladas: number; faltas: number; encaixes: number; com_atraso: number; espera_media_min: number | null;
  };
  semana: { data: string; consultas: number; faltas: number }[];
  porMedico: { medico_nome: string; consultas: number; finalizadas: number; atraso_min: number }[];
  lista_espera: number;
  boletos_pendentes: number;
  valor_pendente: number;
  boletos_vencidos: number;
  exames_em_andamento: number;
  pacientes: number;
}

const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// Visualizar dashboard e indicadores
export function Dashboard() {
  const [dia, setDia] = useState(hojeISO());
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Dados>(`/dashboard?data=${dia}`), [dia]);
  useEventos(['fila', 'agenda'], recarregar);

  if (carregando || !dados) return <Carregando />;
  const d = dados.dia;
  const ativas = d.total - d.canceladas;
  const comparecimento = d.finalizadas + d.faltas ? Math.round((d.finalizadas / (d.finalizadas + d.faltas)) * 100) : null;
  const max = Math.max(1, ...dados.semana.map((s) => s.consultas));

  return (
    <>
      <Cabecalho
        titulo="Indicadores"
        descricao={diaExtenso(dados.data)}
        acoes={<input type="date" aria-label="Dia" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />}
      />

      <section className="indicador-principal" aria-label="Movimento do dia">
        <div className="ip-numero">
          <span className="ip-valor">{ativas}</span>
          <span className="ip-rotulo">consultas no dia</span>
        </div>
        <div className="ip-dia">
          <div className="ip-barra" aria-hidden>
            {([['c-final', d.finalizadas], ['c-atend', d.em_atendimento], ['c-espera', d.aguardando], ['c-chegar', d.agendadas]] as const).map(
              ([cls, n]) => n > 0 && <span key={cls} className={cls} style={{ flex: n }} />,
            )}
          </div>
          <ul className="ip-fluxo" aria-label="Situação das consultas">
            <li className="c-final"><span className="ip-n">{d.finalizadas}</span> finalizadas</li>
            <li className="c-atend"><span className="ip-n">{d.em_atendimento}</span> em atendimento</li>
            <li className="c-espera"><span className="ip-n">{d.aguardando}</span> aguardando</li>
            <li className="c-chegar"><span className="ip-n">{d.agendadas}</span> ainda não chegaram</li>
          </ul>
        </div>
      </section>

      <div className="indicadores">
        <Indicador valor={d.espera_media_min != null ? `${d.espera_media_min} min` : '—'} rotulo="Espera média" dica="Do check-in ao início do atendimento" />
        <Indicador valor={comparecimento != null ? `${comparecimento}%` : '—'} rotulo="Comparecimento" dica={`${d.faltas} ${d.faltas === 1 ? 'falta' : 'faltas'}`} />
        <Indicador valor={d.canceladas} rotulo="Cancelamentos" />
        <Indicador valor={d.encaixes} rotulo="Encaixes" />
        <Indicador valor={d.com_atraso} rotulo="Consultas com atraso" />
        <Indicador valor={dados.lista_espera} rotulo="Na lista de espera" />
        <Indicador valor={dados.boletos_pendentes} rotulo="Boletos pendentes" dica={`${dinheiro(dados.valor_pendente)}, ${dados.boletos_vencidos} vencidos`} />
        <Indicador valor={dados.exames_em_andamento} rotulo="Exames aguardando resultado" />
      </div>

      <div className="colunas">
        <section className="painel">
          <h2>Consultas nos últimos 7 dias</h2>
          <div className="grafico-barras" role="img" aria-label={dados.semana.map((s) => `${diaExtenso(s.data)}: ${s.consultas} consultas`).join('; ')}>
            {dados.semana.map((s) => {
              const dt = paraData(s.data);
              const atual = s.data === dados.data;
              return (
                <div key={s.data} className={`gb-coluna ${atual ? 'gb-atual' : ''}`} tabIndex={0} aria-label={`${diaExtenso(s.data)}: ${s.consultas} consultas, ${s.faltas} faltas`}>
                  <span className="gb-dica" role="tooltip">{diaExtenso(s.data)}<br />{s.consultas} consultas, {s.faltas} faltas</span>
                  <div className="gb-area">
                    {atual && <span className="gb-valor">{s.consultas}</span>}
                    <div className="gb-barra" style={{ height: `${(s.consultas / max) * 100}%` }} />
                  </div>
                  <span className="gb-rotulo">{DIA[dt.getDay()]} {dt.getDate()}</span>
                </div>
              );
            })}
          </div>
          <p className="texto-suave">Sem contar cancelamentos. Passe o mouse sobre a barra para ver as faltas.</p>
        </section>

        <section className="painel">
          <h2>Por médico</h2>
          <table className="tabela tabela-compacta">
            <thead><tr><th>Médico</th><th className="num">Consultas</th><th className="num">Finalizadas</th><th className="num">Atraso</th></tr></thead>
            <tbody>
              {dados.porMedico.map((m) => (
                <tr key={m.medico_nome}>
                  <td data-rotulo="Médico">{m.medico_nome}</td>
                  <td data-rotulo="Consultas" className="num">{m.consultas}</td>
                  <td data-rotulo="Finalizadas" className="num">{m.finalizadas}</td>
                  <td data-rotulo="Atraso" className="num">{m.atraso_min ? `${m.atraso_min} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Indicador({ valor, rotulo, dica }: { valor: string | number; rotulo: string; dica?: string }) {
  return (
    <div className="indicador">
      <span className="indicador-valor">{valor}</span>
      <span className="indicador-rotulo">{rotulo}</span>
      {dica && <span className="indicador-dica">{dica}</span>}
    </div>
  );
}
