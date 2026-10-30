import type { Documento } from '../api';
import { cpf, data } from '../formato';
import { Botao, Modal } from './ui';

/** Visualização para impressão de receita ou atestado. */
export function ModalDocumento({ doc, aoFechar }: { doc: Documento | null; aoFechar: () => void }) {
  const diasAtestado = doc?.tipo === 'ATESTADO'
    ? doc.conteudo.match(/^Dias de afastamento:\s*(\d+)\s*$/m)?.[1]
    : undefined;
  const cidAtestado = doc?.tipo === 'ATESTADO'
    ? doc.conteudo.match(/^CID:\s*(.+)\s*$/m)?.[1]
    : undefined;

  return (
    <Modal aberto={!!doc} aoFechar={aoFechar} titulo={doc?.tipo === 'RECEITA' ? 'Receita' : 'Atestado'}>
      {doc && (
        <>
          <article className="documento" id="documento-impressao">
            <header>
              <strong>Agenda-Saúde</strong>
              <span>{doc.tipo === 'RECEITA' ? 'Receituário' : 'Atestado médico'} nº {doc.id}</span>
            </header>
            <p><strong>Paciente:</strong> {doc.paciente_nome} (CPF {cpf(doc.paciente_cpf)})</p>
            {diasAtestado ? (
              <div className="documento-texto">
                <p>Atesto, para os devidos fins, que o(a) paciente necessita de afastamento de suas atividades por {diasAtestado} {Number(diasAtestado) === 1 ? 'dia' : 'dias'}.</p>
                {cidAtestado && <p><strong>CID:</strong> {cidAtestado}</p>}
              </div>
            ) : (
              <p className="documento-texto">{doc.conteudo}</p>
            )}
            <footer>
              <span>Emitido em {data(doc.data_emissao)}</span>
              {doc.tipo === 'ATESTADO' ? (
                <>
                  <span>Profissional responsável: {doc.medico_nome ?? 'Não informado'}</span>
                  <span>CRM: {doc.crm ? `${doc.crm}${doc.crm_uf ? `/${doc.crm_uf}` : ''}` : 'Não informado'}</span>
                </>
              ) : (
                <span>{doc.medico_nome}{doc.crm ? `, CRM ${doc.crm}/${doc.crm_uf}` : ''}</span>
              )}
              {doc.tipo === 'RECEITA' && <span>{doc.data_retirada ? `Retirada na farmácia em ${data(doc.data_retirada)}` : 'Ainda não retirada'}</span>}
            </footer>
          </article>
          <div className="modal-acoes">
            <Botao variante="secundario" onClick={() => window.print()}>{doc.tipo === 'ATESTADO' ? 'Baixar / imprimir' : 'Imprimir'}</Botao>
            <Botao onClick={aoFechar}>Fechar</Botao>
          </div>
        </>
      )}
    </Modal>
  );
}
