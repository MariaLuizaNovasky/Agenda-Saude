import { useState, type FormEvent } from 'react';
import { api, type Convenio, type Usuario } from '../api';
import { useAuth, useUsuario } from '../auth';
import { Botao, Cabecalho, Campo, useAcao, useToast } from '../components/ui';
import { cpf, data, mascaraTelefone, PERFIL } from '../formato';
import { useCarregar } from '../hooks';
import { FormSenha } from './TrocarSenha';

// Usuario.alterarSenha() e Paciente.editarDados()
export function Perfil() {
  const u = useUsuario();
  const { atualizar } = useAuth();
  const toast = useToast();
  const [executar, salvando] = useAcao();
  const convenios = useCarregar(() => api.get<Convenio[]>('/convenios'));
  const [f, setF] = useState({ nome: u.nome, telefone: u.telefone ?? '', convenio_id: u.convenio_id ?? null, numero_carteirinha: u.numero_carteirinha ?? '' });

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const r = await executar(() => api.put<Usuario>('/auth/perfil', { ...f, numero_carteirinha: f.numero_carteirinha || null }), 'Dados salvos.');
    if (r) atualizar(r);
  };

  return (
    <>
      <Cabecalho titulo="Meus dados" descricao={`Perfil ${PERFIL[u.tipo].toLowerCase()}, entrando com ${u.email}`} />
      <div className="colunas">
        <section className="painel">
          <h2>Dados pessoais</h2>
          <form className="form" onSubmit={salvar}>
            <Campo rotulo="Nome completo">
              <input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
            </Campo>
            <Campo rotulo="Telefone">
              <input required value={f.telefone} onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} />
            </Campo>
            {u.tipo === 'PACIENTE' && (
              <>
                <dl className="dados">
                  <div><dt>CPF</dt><dd>{cpf(u.cpf)}</dd></div>
                  <div><dt>Nascimento</dt><dd>{data(u.data_nascimento)}</dd></div>
                </dl>
                <Campo rotulo="Convênio">
                  <select value={f.convenio_id ?? ''} onChange={(e) => setF({ ...f, convenio_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Particular (sem convênio)</option>
                    {convenios.dados?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </Campo>
                {f.convenio_id && (
                  <Campo rotulo="Número da carteirinha">
                    <input required value={f.numero_carteirinha} onChange={(e) => setF({ ...f, numero_carteirinha: e.target.value })} />
                  </Campo>
                )}
                <p className="texto-suave">Para corrigir CPF ou data de nascimento, fale com a recepção.</p>
              </>
            )}
            {u.tipo === 'MEDICO' && (
              <dl className="dados">
                <div><dt>CRM</dt><dd>{u.crm}/{u.crm_uf} {u.crm_verificado ? '(verificado)' : '(aguardando verificação)'}</dd></div>
              </dl>
            )}
            <Botao type="submit" carregando={salvando}>Salvar dados</Botao>
          </form>
        </section>
        <section className="painel">
          <h2>Alterar senha</h2>
          <FormSenha aoConcluir={(nu) => { toast('Senha alterada.'); atualizar(nu); }} />
        </section>
      </div>
    </>
  );
}
