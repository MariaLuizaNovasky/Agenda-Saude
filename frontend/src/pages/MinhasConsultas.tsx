import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Consulta } from '../api';
import { ModalCancelar, ModalReagendar } from '../components/AcoesConsulta';
import { Abas, Botao, Cabecalho, Carregando, StatusConsultaTag, useAcao, Vazio } from '../components/ui';
import { hojeISO, hora, relativoDia, TIPO, data } from '../formato';
import { useCarregar, useEventos } from '../hooks';

// Visualizar agendamentos; reagendar ou cancelar; realizar check-in
export function MinhasConsultas() {
  const [aba, setAba] = useState<'proximas' | 'anteriores'>('proximas');
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Consulta[]>('/consultas?ordem=asc'));
  useEventos(['fila', 'agenda'], recarregar);
  const [remarcar, setRemarcar] = useState<Consulta | null>(null);
  const [cancelar, setCancelar] = useState<Consulta | null>(null);
  const [executar, executando] = useAcao();

  const ativas = ['AGENDADA', 'CONFIRMADA', 'EM_ESPERA', 'EM_ATENDIMENTO'];
  const proximas = dados?.filter((c) => ativas.includes(c.status)) ?? [];
  const anteriores = (dados?.filter((c) => !ativas.includes(c.status)) ?? []).reverse();
  const lista = aba === 'proximas' ? proximas : anteriores;

  return (
    <>
      <Cabecalho titulo="Minhas consultas" acoes={<Link className="btn btn-primario" to="/agendar">Agendar consulta</Link>} />
      <Abas valor={aba} aoMudar={setAba} opcoes={[{ valor: 'proximas', rotulo: 'Próximas', contagem: proximas.length }, { valor: 'anteriores', rotulo: 'Anteriores', contagem: anteriores.length }]} />
      {carregando ? (
        <Carregando />
      ) : !lista.length ? (
        <Vazio titulo={aba === 'proximas' ? 'Nenhuma consulta marcada' : 'Nenhuma consulta anterior'}>
          {aba === 'proximas' && <Link to="/agendar">Agende sua consulta</Link>}
        </Vazio>
      ) : (
        <ul className="cartoes">
          {lista.map((c) => {
            const hoje = c.data_hora.slice(0, 10) === hojeISO();
            const editavel = ['AGENDADA', 'CONFIRMADA'].includes(c.status);
            return (
              <li key={c.id} className="cartao-consulta">
                <div className="cc-quando">
                  <span>{aba === 'proximas' ? relativoDia(c.data_hora) : data(c.data_hora)}</span>
                  <strong>{hora(c.data_hora)}</strong>
                </div>
                <div className="cc-info">
                  <p className="cc-titulo">{TIPO[c.tipo]} com {c.medico_nome}</p>
                  <p className="texto-suave">{c.especialidades}</p>
                  {c.motivo_cancelamento && <p className="texto-suave">Motivo: {c.motivo_cancelamento}</p>}
                  {c.atraso_min > 0 && hoje && editavel && <p className="texto-alerta">Atraso de cerca de {c.atraso_min} min</p>}
                </div>
                <div className="cc-acoes">
                  <StatusConsultaTag status={c.status} />
                  {hoje && c.status === 'AGENDADA' && (
                    <Botao carregando={executando} onClick={() => executar(() => api.post(`/consultas/${c.id}/checkin`), 'Check-in feito. A recepção vai confirmar sua presença.').then(recarregar)}>
                      Fazer check-in
                    </Botao>
                  )}
                  {hoje && ['CONFIRMADA', 'EM_ESPERA', 'EM_ATENDIMENTO'].includes(c.status) && <Link to="/fila" className="btn btn-secundario">Ver fila</Link>}
                  {editavel && (
                    <>
                      <Botao variante="secundario" onClick={() => setRemarcar(c)}>Remarcar</Botao>
                      <Botao variante="texto" onClick={() => setCancelar(c)}>Cancelar</Botao>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ModalReagendar consulta={remarcar} aoFechar={() => setRemarcar(null)} aoConcluir={() => { setRemarcar(null); recarregar(); }} />
      <ModalCancelar consulta={cancelar} aoFechar={() => setCancelar(null)} aoConcluir={() => { setCancelar(null); recarregar(); }} />
    </>
  );
}
