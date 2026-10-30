import { useRef, useState } from 'react';
import { api, baixarArquivo, qs, type Exame } from '../api';
import { useUsuario } from '../auth';
import { Abas, Botao, Cabecalho, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { cpf, data } from '../formato';
import { useCarregar } from '../hooks';
import { STATUS_EXAME, TOM_EXAME } from './Historico';

// Laboratório: atualizar status / anexar resultado. Médico: acompanhar exames pedidos.
export function Exames() {
  const u = useUsuario();
  const lab = u.tipo === 'LABORATORIO';
  const [filtro, setFiltro] = useState<'SOLICITADO,COLETADO' | 'CONCLUIDO' | ''>('SOLICITADO,COLETADO');
  const [busca, setBusca] = useState('');
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Exame[]>(`/exames${qs({ status: filtro, busca })}`), [filtro, busca]);
  const [executar, executando] = useAcao();
  const [anexar, setAnexar] = useState<Exame | null>(null);

  return (
    <>
      <Cabecalho
        titulo={lab ? 'Exames' : 'Exames solicitados'}
        descricao={lab ? 'Registre a coleta e anexe o resultado. O paciente e o médico são avisados na hora.' : 'Exames que você pediu e a situação no laboratório.'}
      />
      <div className="filtros">
        <Abas valor={filtro} aoMudar={setFiltro} opcoes={[{ valor: 'SOLICITADO,COLETADO', rotulo: 'Em andamento' }, { valor: 'CONCLUIDO', rotulo: 'Concluídos' }, { valor: '', rotulo: 'Todos' }]} />
        <input type="search" placeholder="Paciente, CPF ou exame" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {carregando ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhum exame nesta lista" />
      ) : (
        <table className="tabela">
          <thead><tr><th>Nº</th><th>Exame</th><th>Paciente</th>{lab && <th>Médico</th>}<th>Pedido em</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {dados.map((e) => (
              <tr key={e.id}>
                <td data-rotulo="Nº">{e.id}</td>
                <td data-rotulo="Exame"><strong>{e.tipo}</strong></td>
                <td data-rotulo="Paciente">{e.paciente_nome}<div className="texto-suave">{cpf(e.paciente_cpf)}</div></td>
                {lab && <td data-rotulo="Médico">{e.medico_nome}</td>}
                <td data-rotulo="Pedido em">{data(e.data_solicitacao)}</td>
                <td data-rotulo="Situação"><Tag tom={TOM_EXAME[e.status]}>{STATUS_EXAME[e.status]}</Tag></td>
                <td className="celula-acoes">
                  {lab && e.status === 'SOLICITADO' && (
                    <Botao variante="secundario" carregando={executando} onClick={() => executar(() => api.put(`/exames/${e.id}/status`, { status: 'COLETADO' }), 'Coleta registrada.').then(recarregar)}>Registrar coleta</Botao>
                  )}
                  {lab && e.status !== 'CONCLUIDO' && <Botao onClick={() => setAnexar(e)}>Anexar resultado</Botao>}
                  {e.arquivo_resultado && <Botao variante="texto" onClick={() => executar(() => baixarArquivo(`/exames/${e.id}/arquivo`, e.arquivo_nome ?? 'resultado'))}>Baixar</Botao>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ModalResultado exame={anexar} aoFechar={() => setAnexar(null)} aoConcluir={() => { setAnexar(null); recarregar(); }} />
    </>
  );
}

// Exame.anexarResultado(arquivo)
function ModalResultado({ exame, aoFechar, aoConcluir }: { exame: Exame | null; aoFechar: () => void; aoConcluir: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [executar, executando] = useAcao();
  return (
    <Modal aberto={!!exame} aoFechar={() => { setArquivo(null); aoFechar(); }} titulo="Anexar resultado">
      {exame && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!arquivo) return;
            const fd = new FormData();
            fd.append('arquivo', arquivo);
            const r = await executar(() => api.post(`/exames/${exame.id}/resultado`, fd), 'Resultado anexado. Paciente e médico foram avisados.');
            if (r) { setArquivo(null); aoConcluir(); }
          }}
        >
          <p><strong>{exame.tipo}</strong> de {exame.paciente_nome}, pedido por {exame.medico_nome}.</p>
          <label className="arquivo">
            <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <span>{arquivo ? arquivo.name : 'Escolher arquivo (PDF, PNG ou JPG, até 10 MB)'}</span>
          </label>
          <div className="modal-acoes">
            <Botao type="button" variante="secundario" onClick={aoFechar}>Voltar</Botao>
            <Botao type="submit" disabled={!arquivo} carregando={executando}>Anexar e concluir exame</Botao>
          </div>
        </form>
      )}
    </Modal>
  );
}
