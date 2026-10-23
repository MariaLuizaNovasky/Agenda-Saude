import { useState } from 'react';
import { api, qs, type Boleto } from '../api';
import { useUsuario } from '../auth';
import { Abas, Botao, Cabecalho, Campo, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { cpf, data, dinheiro } from '../formato';
import { useCarregar } from '../hooks';

const STATUS_BOLETO = { PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado' } as const;

// Consultar boletos (paciente) / Gerenciar e cancelar boletos (financeiro e administrador)
export function Boletos() {
  const u = useUsuario();
  const gestor = u.tipo !== 'PACIENTE';
  const [status, setStatus] = useState<'' | 'PENDENTE' | 'PAGO' | 'CANCELADO'>(gestor ? 'PENDENTE' : '');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Boleto[]>(`/boletos${qs({ status, tipo, busca })}`), [status, tipo, busca]);
  const [executar, executando] = useAcao();
  const [editar, setEditar] = useState<Boleto | null>(null);

  const total = dados?.filter((b) => b.status === 'PENDENTE').reduce((s, b) => s + b.valor, 0) ?? 0;

  return (
    <>
      <Cabecalho
        titulo="Boletos"
        descricao={gestor ? 'O registro de pagamento é manual: a emissão bancária fica fora do escopo inicial.' : 'Cobranças das suas consultas. Consultas por convênio são cobradas do plano.'}
      />
      <div className="filtros">
        <Abas
          valor={status}
          aoMudar={setStatus}
          opcoes={[{ valor: '', rotulo: 'Todos' }, { valor: 'PENDENTE', rotulo: 'Pendentes' }, { valor: 'PAGO', rotulo: 'Pagos' }, { valor: 'CANCELADO', rotulo: 'Cancelados' }]}
        />
        {gestor && (
          <>
            <select aria-label="Tipo de cobrança" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Particulares e convênios</option>
              <option value="PARTICULAR">Só particulares</option>
              <option value="CONVENIO">Só convênios</option>
            </select>
            <input type="search" placeholder="Paciente ou CPF" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </>
        )}
      </div>
      {!!total && <p className="resumo-linha">Pendente nesta lista: <strong>{dinheiro(total)}</strong></p>}
      {carregando ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhum boleto encontrado" />
      ) : (
        <table className="tabela">
          <thead>
            <tr>
              <th>Nº</th>
              {gestor && <th>Paciente</th>}
              <th>Consulta</th>
              <th>Cobrança</th>
              <th className="num">Valor</th>
              <th>Vencimento</th>
              <th>Situação</th>
              {gestor && <th />}
            </tr>
          </thead>
          <tbody>
            {dados.map((b) => (
              <tr key={b.id}>
                <td data-rotulo="Nº">{b.id}</td>
                {gestor && (
                  <td data-rotulo="Paciente">
                    <strong>{b.paciente_nome}</strong>
                    <div className="texto-suave">{cpf(b.paciente_cpf)}</div>
                  </td>
                )}
                <td data-rotulo="Consulta">{data(b.data_hora)} com {b.medico_nome}</td>
                <td data-rotulo="Cobrança">{b.convenio_nome ? `Convênio ${b.convenio_nome}` : 'Particular'}</td>
                <td data-rotulo="Valor" className="num">{dinheiro(b.valor)}</td>
                <td data-rotulo="Vencimento">{data(b.vencimento)}</td>
                <td data-rotulo="Situação">
                  {b.vencido ? <Tag tom="perigo">Vencido</Tag> : <Tag tom={b.status === 'PAGO' ? 'ok' : b.status === 'CANCELADO' ? 'neutro' : 'alerta'}>{STATUS_BOLETO[b.status]}</Tag>}
                </td>
                {gestor && (
                  <td className="celula-acoes">
                    {b.status === 'PENDENTE' && (
                      <>
                        <Botao carregando={executando} onClick={() => executar(() => api.post(`/boletos/${b.id}/baixa`), `Boleto ${b.id} marcado como pago.`).then(recarregar)}>Dar baixa</Botao>
                        <Botao variante="secundario" onClick={() => setEditar(b)}>Editar</Botao>
                        <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.post(`/boletos/${b.id}/cancelar`), `Boleto ${b.id} cancelado.`).then(recarregar)}>Cancelar</Botao>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ModalEditar boleto={editar} aoFechar={() => setEditar(null)} aoConcluir={() => { setEditar(null); recarregar(); }} />
    </>
  );
}

function ModalEditar({ boleto, aoFechar, aoConcluir }: { boleto: Boleto | null; aoFechar: () => void; aoConcluir: () => void }) {
  const [valor, setValor] = useState('');
  const [venc, setVenc] = useState('');
  const [executar, executando] = useAcao();
  const [aberto, setAberto] = useState<number | null>(null);
  if (boleto && aberto !== boleto.id) {
    setAberto(boleto.id);
    setValor(String(boleto.valor));
    setVenc(boleto.vencimento);
  }
  return (
    <Modal aberto={!!boleto} aoFechar={() => { setAberto(null); aoFechar(); }} titulo={`Editar boleto ${boleto?.id ?? ''}`}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await executar(() => api.put(`/boletos/${boleto!.id}`, { valor: Number(valor), vencimento: venc }), 'Boleto atualizado.');
          if (r) { setAberto(null); aoConcluir(); }
        }}
      >
        <div className="grade-campos">
          <Campo rotulo="Valor (R$)"><input type="number" min={0} step="0.01" required value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
          <Campo rotulo="Vencimento"><input type="date" required value={venc} onChange={(e) => setVenc(e.target.value)} /></Campo>
        </div>
        <div className="modal-acoes">
          <Botao type="button" variante="secundario" onClick={aoFechar}>Voltar</Botao>
          <Botao type="submit" carregando={executando}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}
