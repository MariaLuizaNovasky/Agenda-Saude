import { useState, type FormEvent } from 'react';
import { api, qs, type Especialidade, type Perfil } from '../api';
import { Botao, Cabecalho, Campo, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { mascaraTelefone, PERFIL, UFS } from '../formato';
import { useCarregar } from '../hooks';

interface UsuarioAdmin {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  tipo: Perfil;
  ativo: number;
  troca_senha_obrigatoria: number;
  recuperacao_solicitada: number;
  crm: string | null;
  crm_uf: string | null;
  crm_verificado: number | null;
  especialidade_ids: string | null;
}

const EQUIPE: Perfil[] = ['RECEPCIONISTA', 'MEDICO', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'];

/** Sugere uma senha temporária que atende à regra (letras e números). */
const sugerirSenha = () => `Temp${Math.floor(1000 + Math.random() * 9000)}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}`;

// Gerenciar usuários e permissões de acesso
export function Usuarios() {
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const { dados, carregando, recarregar } = useCarregar(() => api.get<UsuarioAdmin[]>(`/usuarios${qs({ tipo, busca })}`), [tipo, busca]);
  const especialidades = useCarregar(() => api.get<Especialidade[]>('/especialidades'));
  const [editar, setEditar] = useState<UsuarioAdmin | 'novo' | null>(null);
  const [senhaDe, setSenhaDe] = useState<UsuarioAdmin | null>(null);
  const [executar, executando] = useAcao();

  const pedidos = dados?.filter((u) => u.recuperacao_solicitada) ?? [];

  return (
    <>
      <Cabecalho titulo="Usuários e acessos" descricao="Pacientes se cadastram sozinhos. A equipe é criada aqui, com senha temporária." acoes={<Botao onClick={() => setEditar('novo')}>Criar usuário da equipe</Botao>} />

      {pedidos.length > 0 && (
        <section className="painel painel-atencao">
          <h2>Pedidos de nova senha</h2>
          <ul className="lista">
            {pedidos.map((u) => (
              <li key={u.id} className="lista-item">
                <span><strong>{u.nome}</strong> ({PERFIL[u.tipo]}), {u.email}</span>
                <Botao onClick={() => setSenhaDe(u)}>Gerar senha temporária</Botao>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="filtros">
        <select aria-label="Perfil" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos os perfis</option>
          {(['PACIENTE', ...EQUIPE] as Perfil[]).map((p) => <option key={p} value={p}>{PERFIL[p]}</option>)}
        </select>
        <input type="search" placeholder="Nome ou e-mail" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {carregando ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhum usuário encontrado" />
      ) : (
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {dados.map((u) => (
              <tr key={u.id} className={u.ativo ? '' : 'linha-apagada'}>
                <td data-rotulo="Nome"><strong>{u.nome}</strong><div className="texto-suave">{u.email}</div></td>
                <td data-rotulo="Perfil">
                  {PERFIL[u.tipo]}
                  {u.tipo === 'MEDICO' && (
                    <div className="texto-suave">
                      CRM {u.crm}/{u.crm_uf} {u.crm_verificado ? <Tag tom="ok">Verificado</Tag> : <Tag tom="alerta">Verificar</Tag>}
                    </div>
                  )}
                </td>
                <td data-rotulo="Situação">
                  {u.ativo ? <Tag tom="ok">Ativo</Tag> : <Tag tom="neutro">Desativado</Tag>}{' '}
                  {!!u.troca_senha_obrigatoria && <Tag tom="info">Senha temporária</Tag>}
                </td>
                <td className="celula-acoes">
                  {u.tipo === 'MEDICO' && (
                    <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.post(`/medicos/${u.id}/verificar-crm`, { verificado: !u.crm_verificado }), u.crm_verificado ? 'CRM marcado como pendente.' : 'CRM confirmado.').then(recarregar)}>
                      {u.crm_verificado ? 'Desfazer verificação' : 'Confirmar CRM'}
                    </Botao>
                  )}
                  <Botao variante="secundario" onClick={() => setSenhaDe(u)}>Nova senha</Botao>
                  <Botao variante="secundario" onClick={() => setEditar(u)}>Editar</Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ModalUsuario usuario={editar} especialidades={especialidades.dados ?? []} aoFechar={() => setEditar(null)} aoConcluir={() => { setEditar(null); recarregar(); }} />
      <ModalSenha usuario={senhaDe} aoFechar={() => setSenhaDe(null)} aoConcluir={() => { setSenhaDe(null); recarregar(); }} />
    </>
  );
}

function ModalUsuario({ usuario, especialidades, aoFechar, aoConcluir }: { usuario: UsuarioAdmin | 'novo' | null; especialidades: Especialidade[]; aoFechar: () => void; aoConcluir: () => void }) {
  const novo = usuario === 'novo';
  const [chave, setChave] = useState<string | null>(null);
  const [f, setF] = useState({ nome: '', email: '', telefone: '', tipo: 'RECEPCIONISTA' as Perfil, ativo: true, senha_temporaria: '', crm: '', crm_uf: 'SP', especialidade_ids: [] as number[] });
  const [executar, executando] = useAcao();

  const k = usuario === null ? null : novo ? 'novo' : String(usuario.id);
  if (k !== chave) {
    setChave(k);
    if (usuario && usuario !== 'novo') {
      setF({
        nome: usuario.nome, email: usuario.email, telefone: usuario.telefone ?? '', tipo: usuario.tipo, ativo: !!usuario.ativo, senha_temporaria: '',
        crm: usuario.crm ?? '', crm_uf: usuario.crm_uf ?? 'SP', especialidade_ids: usuario.especialidade_ids?.split(',').map(Number) ?? [],
      });
    } else setF({ nome: '', email: '', telefone: '', tipo: 'RECEPCIONISTA', ativo: true, senha_temporaria: sugerirSenha(), crm: '', crm_uf: 'SP', especialidade_ids: [] });
  }

  const medico = f.tipo === 'MEDICO';
  const atual = usuario && usuario !== 'novo' ? usuario : null;
  const fixo = atual && (atual.tipo === 'PACIENTE' || atual.tipo === 'MEDICO');

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const extra = medico ? { crm: f.crm, crm_uf: f.crm_uf, especialidade_ids: f.especialidade_ids } : {};
    const r = novo
      ? await executar(() => api.post('/usuarios', { nome: f.nome, email: f.email, telefone: f.telefone || undefined, tipo: f.tipo, senha_temporaria: f.senha_temporaria, ...extra }), `Usuário criado. Senha temporária: ${f.senha_temporaria}`)
      : await executar(() => api.put(`/usuarios/${atual!.id}`, { nome: f.nome, telefone: f.telefone || null, tipo: f.tipo, ativo: f.ativo, ...extra }), 'Usuário atualizado.');
    if (r) aoConcluir();
  };

  return (
    <Modal aberto={usuario !== null} aoFechar={aoFechar} titulo={novo ? 'Criar usuário da equipe' : `Editar ${atual?.nome ?? ''}`} largo>
      <form className="form" onSubmit={enviar}>
        <div className="grade-campos">
          <Campo rotulo="Nome completo" largo><input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Campo>
          <Campo rotulo="E-mail"><input type="email" required disabled={!novo} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
          <Campo rotulo="Telefone"><input value={f.telefone} onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} /></Campo>
          <Campo rotulo="Perfil de acesso" dica={fixo ? 'Pacientes e médicos não mudam de perfil.' : undefined}>
            <select value={f.tipo} disabled={!!fixo} onChange={(e) => setF({ ...f, tipo: e.target.value as Perfil })}>
              {(fixo ? [atual!.tipo] : novo ? EQUIPE : EQUIPE.filter((p) => p !== 'MEDICO')).map((p) => <option key={p} value={p}>{PERFIL[p]}</option>)}
            </select>
          </Campo>
          {novo ? (
            <Campo rotulo="Senha temporária" dica="Passe ao usuário. Ele cria a própria senha no primeiro acesso.">
              <input required minLength={8} value={f.senha_temporaria} onChange={(e) => setF({ ...f, senha_temporaria: e.target.value })} />
            </Campo>
          ) : (
            <label className="campo campo-check">
              <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
              <span>Acesso ativo</span>
            </label>
          )}
        </div>
        {medico && (
          <fieldset className="grupo">
            <legend>Dados do médico</legend>
            <div className="grade-campos">
              <Campo rotulo="CRM" dica="Só números. O formato é checado aqui; a situação no conselho é confirmada pela administração.">
                <input required inputMode="numeric" pattern="\d{4,7}" value={f.crm} onChange={(e) => setF({ ...f, crm: e.target.value.replace(/\D/g, '') })} />
              </Campo>
              <Campo rotulo="UF do CRM">
                <select value={f.crm_uf} onChange={(e) => setF({ ...f, crm_uf: e.target.value })}>{UFS.map((u) => <option key={u}>{u}</option>)}</select>
              </Campo>
              <Campo
                rotulo="Especialidades médicas"
                dica="Selecione uma especialidade por vez. As opções vêm do cadastro de Especialidades e convênios."
                largo
              >
                <select
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id && !f.especialidade_ids.includes(id)) {
                      setF({ ...f, especialidade_ids: [...f.especialidade_ids, id] });
                    }
                  }}
                  aria-label="Adicionar especialidade médica"
                >
                  <option value="">Selecione uma especialidade...</option>
                  {especialidades
                    .filter((especialidade) => !f.especialidade_ids.includes(especialidade.id))
                    .map((especialidade) => (
                      <option key={especialidade.id} value={especialidade.id}>{especialidade.nome}</option>
                    ))}
                </select>
              </Campo>
            </div>
            {f.especialidade_ids.length > 0 ? (
              <ul className="checks especialidades-selecionadas" aria-label="Especialidades selecionadas">
                {f.especialidade_ids.map((id) => {
                  const especialidade = especialidades.find((item) => item.id === id);
                  if (!especialidade) return null;
                  return (
                    <li className="tag-especialidade" key={id}>
                      <span>{especialidade.nome}</span>
                      <button
                        type="button"
                        aria-label={`Remover ${especialidade.nome}`}
                        onClick={() => setF({ ...f, especialidade_ids: f.especialidade_ids.filter((item) => item !== id) })}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="texto-suave">Selecione pelo menos uma especialidade para continuar.</p>
            )}
          </fieldset>
        )}
        <div className="modal-acoes">
          <Botao type="button" variante="secundario" onClick={aoFechar}>Voltar</Botao>
          <Botao type="submit" carregando={executando}>{novo ? 'Criar usuário' : 'Salvar'}</Botao>
        </div>
      </form>
    </Modal>
  );
}

function ModalSenha({ usuario, aoFechar, aoConcluir }: { usuario: UsuarioAdmin | null; aoFechar: () => void; aoConcluir: () => void }) {
  const [senha, setSenha] = useState('');
  const [de, setDe] = useState<number | null>(null);
  const [executar, executando] = useAcao();
  if (usuario && de !== usuario.id) { setDe(usuario.id); setSenha(sugerirSenha()); }
  return (
    <Modal aberto={!!usuario} aoFechar={() => { setDe(null); aoFechar(); }} titulo="Senha temporária">
      {usuario && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await executar(() => api.post(`/usuarios/${usuario.id}/senha-temporaria`, { senha }), `Senha temporária de ${usuario.nome}: ${senha}`);
            if (r) { setDe(null); aoConcluir(); }
          }}
        >
          <p>{usuario.nome} vai entrar com esta senha e criar uma nova em seguida. Passe a senha por um canal seguro.</p>
          <Campo rotulo="Senha temporária"><input required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
          <div className="modal-acoes">
            <Botao type="button" variante="secundario" onClick={aoFechar}>Voltar</Botao>
            <Botao type="submit" carregando={executando}>Definir senha temporária</Botao>
          </div>
        </form>
      )}
    </Modal>
  );
}
