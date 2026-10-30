import { useEffect, useState } from 'react';
import { api, type Horario } from '../api';
import { paraData } from '../formato';
import { useCarregar } from '../hooks';
import { Carregando, Vazio } from './ui';

const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Escolha de dia e horário livre na agenda de um médico (Disponibilidade.gerarHorarios). */
export function SeletorHorario({
  medicoId,
  valor,
  aoEscolher,
  dataInicial,
}: {
  medicoId: string;
  valor: string | null;
  aoEscolher: (dataHora: string | null) => void;
  dataInicial?: string | null;
}) {
  const dias = useCarregar(() => api.get<{ data: string; livres: number }[]>(`/medicos/${medicoId}/dias-livres`), [medicoId]);
  const [dia, setDia] = useState<string | null>(null);

  useEffect(() => {
    if (!dias.dados) return;
    const pref = dataInicial && dias.dados.some((d) => d.data === dataInicial) ? dataInicial : dias.dados[0]?.data ?? null;
    setDia(pref);
  }, [dias.dados, dataInicial]);

  const horarios = useCarregar(() => (dia ? api.get<Horario[]>(`/medicos/${medicoId}/horarios?data=${dia}`) : Promise.resolve([])), [medicoId, dia]);

  if (dias.carregando) return <Carregando texto="Buscando dias com vaga…" />;
  if (!dias.dados?.length) return <Vazio titulo="Sem horários livres nos próximos 30 dias">Entre na lista de espera para ser avisado quando abrir uma vaga.</Vazio>;

  const manha = horarios.dados?.filter((h) => h.data_hora.slice(11) < '12:00') ?? [];
  const tarde = horarios.dados?.filter((h) => h.data_hora.slice(11) >= '12:00') ?? [];

  return (
    <div className="seletor">
      <div className="seletor-dias" role="listbox" aria-label="Dia da consulta">
        {dias.dados.map((d) => {
          const dt = paraData(d.data);
          return (
            <button
              key={d.data}
              type="button"
              role="option"
              aria-selected={dia === d.data}
              className="seletor-dia"
              onClick={() => {
                setDia(d.data);
                aoEscolher(null);
              }}
            >
              <span className="seletor-dia-semana">{DIA_CURTO[dt.getDay()]}</span>
              <span className="seletor-dia-num">{dt.getDate()}</span>
              <span className="seletor-dia-vagas">{d.livres} {d.livres === 1 ? 'vaga' : 'vagas'}</span>
            </button>
          );
        })}
      </div>
      {horarios.carregando ? (
        <Carregando texto="Carregando horários…" />
      ) : (
        [
          ['Manhã', manha],
          ['Tarde e noite', tarde],
        ].map(([rotulo, lista]) =>
          (lista as Horario[]).length ? (
            <fieldset key={rotulo as string} className="seletor-periodo">
              <legend>{rotulo as string}</legend>
              <div className="seletor-horas">
                {(lista as Horario[]).map((h) => (
                  <button
                    key={h.data_hora}
                    type="button"
                    className="seletor-hora"
                    disabled={!h.livre}
                    aria-pressed={valor === h.data_hora}
                    title={h.livre ? undefined : 'Ocupado'}
                    onClick={() => aoEscolher(h.data_hora)}
                  >
                    {h.data_hora.slice(11)}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null,
        )
      )}
    </div>
  );
}
