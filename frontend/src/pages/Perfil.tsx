import { useState, type FormEvent } from 'react';
import { api, type Usuario } from '../api';
import { useAuth, useUsuario } from '../auth';
import { Botao, Cabecalho, Campo, useAcao, useToast } from '../components/ui';
import { cpf, mascaraTelefone, PERFIL } from '../formato';
import { FormSenha } from './TrocarSenha';

// Usuario.alterarSenha() e Paciente.editarDados()
export function Perfil() {
  const u = useUsuario();
  const { atualizar } = useAuth();
  const toast = useToast();
  const [executar, salvando] = useAcao();
  const [f, setF] = useState({
    nome: u.nome,
    telefone: u.telefone ?? '',
    data_nascimento: u.data_nascimento?.slice(0, 10) ?? '',
  });

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const dados = u.tipo === 'PACIENTE'
      ? f
      : { nome: f.nome, telefone: f.telefone };
    const r = await executar(() => api.put<Usuario>('/auth/perfil', dados), 'Dados salvos.');
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
                <Campo rotulo="CPF">
                  <input value={cpf(u.cpf)} disabled />
                </Campo>
                <Campo rotulo="Data de nascimento">
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={f.data_nascimento}
                    onChange={(e) => setF({ ...f, data_nascimento: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Convênio">
                  <input value={u.convenio_nome ?? 'Particular (sem convênio)'} disabled />
                </Campo>
                <Campo rotulo="Número da carteirinha">
                  <input value={u.numero_carteirinha ?? ''} placeholder="Não informado" disabled />
                </Campo>
                <p className="texto-suave">Para alterar CPF, convênio ou carteirinha, fale com a recepção.</p>
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
