import { useState } from 'react';
import { api, type Consulta } from '../api';
import { dataHora } from '../formato';
import { SeletorHorario } from './SeletorHorario';
import { Botao, Campo, Modal, useAcao } from './ui';

/** Consulta.reagendar(novaData) */
export function ModalReagendar({ consulta, aoFechar, aoConcluir }: { consulta: Consulta | null; aoFechar: () => void; aoConcluir: () => void }) {
  const [novo, setNovo] = useState<string | null>(null);
  const [executar, executando] = useAcao();
  return (
    <Modal aberto={!!consulta} aoFechar={() => { setNovo(null); aoFechar(); }} titulo="Remarcar consulta" largo>
      {consulta && (
        <>
          <p className="texto-suave">
            {consulta.paciente_nome} com {consulta.medico_nome}. Horário atual: {dataHora(consulta.data_hora)}.
          </p>
          <SeletorHorario medicoId={consulta.medico_id} valor={novo} aoEscolher={setNovo} dataInicial={consulta.data_hora.slice(0, 10)} />
          <div className="modal-acoes">
            <Botao variante="secundario" onClick={aoFechar}>Voltar</Botao>
            <Botao
              disabled={!novo}
              carregando={executando}
              onClick={async () => {
                const r = await executar(() => api.put(`/consultas/${consulta.id}/reagendar`, { data_hora: novo }), `Consulta remarcada para ${dataHora(novo)}.`);
                if (r) { setNovo(null); aoConcluir(); }
              }}
            >
              {novo ? `Remarcar para ${dataHora(novo)}` : 'Escolha um horário'}
            </Botao>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Consulta.cancelar(motivo) */
export function ModalCancelar({ consulta, aoFechar, aoConcluir }: { consulta: Consulta | null; aoFechar: () => void; aoConcluir: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [executar, executando] = useAcao();
  return (
    <Modal aberto={!!consulta} aoFechar={() => { setMotivo(''); aoFechar(); }} titulo="Cancelar consulta">
      {consulta && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await executar(() => api.post(`/consultas/${consulta.id}/cancelar`, { motivo }), 'Consulta cancelada.');
            if (r) { setMotivo(''); aoConcluir(); }
          }}
        >
          <p>
            {consulta.paciente_nome} com {consulta.medico_nome}, {dataHora(consulta.data_hora)}. O horário fica livre e a lista de espera é avisada.
          </p>
          <Campo rotulo="Motivo do cancelamento">
            <textarea required minLength={3} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <div className="modal-acoes">
            <Botao type="button" variante="secundario" onClick={aoFechar}>Manter consulta</Botao>
            <Botao type="submit" variante="perigo" carregando={executando}>Cancelar consulta</Botao>
          </div>
        </form>
      )}
    </Modal>
  );
}
