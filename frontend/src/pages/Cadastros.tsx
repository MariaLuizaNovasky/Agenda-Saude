import { useState, type FormEvent } from 'react';
import { api, type Convenio, type Especialidade } from '../api';
import { Botao, Cabecalho, Campo, Carregando, useAcao } from '../components/ui';
import { useCarregar } from '../hooks';

// Gerenciar especialidades e convênios
export function Cadastros() {
  const esp = useCarregar(() => api.get<Especialidade[]>('/especialidades'));
  const conv = useCarregar(() => api.get<Convenio[]>('/convenios'));
  const [executar, executando] = useAcao();
  const [novaEsp, setNovaEsp] = useState('');
  const [novoConv, setNovoConv] = useState({ nome: '', registro_ans: '' });
  const [editEsp, setEditEsp] = useState<{ id: number; nome: string } | null>(null);
  const [editConv, setEditConv] = useState<Convenio | null>(null);

  const criarEsp = async (e: FormEvent) => {
    e.preventDefault();
    if (await executar(() => api.post('/especialidades', { nome: novaEsp }), 'Especialidade criada.')) { setNovaEsp(''); esp.recarregar(); }
  };
  const criarConv = async (e: FormEvent) => {
    e.preventDefault();
    if (await executar(() => api.post('/convenios', novoConv), 'Convênio cadastrado.')) { setNovoConv({ nome: '', registro_ans: '' }); conv.recarregar(); }
  };

  return (
    <>
      <Cabecalho titulo="Especialidades e convênios" />
      <div className="colunas">
        <section className="painel">
          <h2>Especialidades</h2>
          {esp.carregando ? <Carregando /> : (
            <ul className="lista">
              {esp.dados?.map((e) => (
                <li key={e.id} className="lista-item">
                  {editEsp?.id === e.id ? (
                    <form className="linha-edicao" onSubmit={async (ev) => { ev.preventDefault(); if (await executar(() => api.put(`/especialidades/${e.id}`, { nome: editEsp.nome }), 'Especialidade renomeada.')) { setEditEsp(null); esp.recarregar(); } }}>
                      <input aria-label="Nome" required value={editEsp.nome} onChange={(x) => setEditEsp({ ...editEsp, nome: x.target.value })} autoFocus />
                      <Botao type="submit" carregando={executando}>Salvar</Botao>
                      <Botao type="button" variante="texto" onClick={() => setEditEsp(null)}>Voltar</Botao>
                    </form>
                  ) : (
                    <>
                      <span><strong>{e.nome}</strong> <span className="texto-suave">{e.total_medicos} {e.total_medicos === 1 ? 'médico' : 'médicos'}</span></span>
                      <span className="lista-acoes">
                        <Botao variante="texto" onClick={() => setEditEsp({ id: e.id, nome: e.nome })}>Renomear</Botao>
                        <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.del(`/especialidades/${e.id}`), 'Especialidade excluída.').then(esp.recarregar)}>Excluir</Botao>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="linha-edicao" onSubmit={criarEsp}>
            <input aria-label="Nova especialidade" placeholder="Nova especialidade" required value={novaEsp} onChange={(e) => setNovaEsp(e.target.value)} />
            <Botao type="submit" carregando={executando}>Adicionar</Botao>
          </form>
        </section>

        <section className="painel">
          <h2>Convênios</h2>
          {conv.carregando ? <Carregando /> : (
            <ul className="lista">
              {conv.dados?.map((c) => (
                <li key={c.id} className="lista-item">
                  {editConv?.id === c.id ? (
                    <form className="linha-edicao" onSubmit={async (ev) => { ev.preventDefault(); if (await executar(() => api.put(`/convenios/${c.id}`, editConv), 'Convênio atualizado.')) { setEditConv(null); conv.recarregar(); } }}>
                      <input aria-label="Nome" required value={editConv.nome} onChange={(x) => setEditConv({ ...editConv, nome: x.target.value })} />
                      <input aria-label="Registro ANS" required pattern="\d{6}" className="curto" value={editConv.registro_ans} onChange={(x) => setEditConv({ ...editConv, registro_ans: x.target.value.replace(/\D/g, '') })} />
                      <Botao type="submit" carregando={executando}>Salvar</Botao>
                      <Botao type="button" variante="texto" onClick={() => setEditConv(null)}>Voltar</Botao>
                    </form>
                  ) : (
                    <>
                      <span><strong>{c.nome}</strong> <span className="texto-suave">ANS {c.registro_ans}</span></span>
                      <span className="lista-acoes">
                        <Botao variante="texto" onClick={() => setEditConv(c)}>Editar</Botao>
                        <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.del(`/convenios/${c.id}`), 'Convênio excluído.').then(conv.recarregar)}>Excluir</Botao>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="form" onSubmit={criarConv}>
            <div className="grade-campos">
              <Campo rotulo="Nome do convênio"><input required value={novoConv.nome} onChange={(e) => setNovoConv({ ...novoConv, nome: e.target.value })} /></Campo>
              <Campo rotulo="Registro ANS" dica="6 dígitos"><input required inputMode="numeric" pattern="\d{6}" value={novoConv.registro_ans} onChange={(e) => setNovoConv({ ...novoConv, registro_ans: e.target.value.replace(/\D/g, '') })} /></Campo>
            </div>
            <Botao type="submit" carregando={executando}>Cadastrar convênio</Botao>
          </form>
        </section>
      </div>
    </>
  );
}
