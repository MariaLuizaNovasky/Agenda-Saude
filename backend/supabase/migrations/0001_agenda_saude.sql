-- =====================================================================
-- Agenda-Saúde: esquema PostgreSQL para o Supabase
-- Tradução do esquema SQLite (src/db.ts) + regras de acesso (RLS).
--
-- Diferenças em relação ao SQLite:
--  * usuarios.id é uuid e aponta para auth.users (Supabase Auth); a senha
--    fica no Auth, por isso não existe senha_hash aqui.
--  * datas e horas em timestamptz; valores em numeric(10,2); flags em boolean.
--  * regras que no SQLite eram só da API agora também valem no banco:
--    transição de status da consulta, 1 atendimento por vez por médico,
--    períodos de agenda sem sobreposição, log imutável.
--  * o papel service_role (usado pelo backend) ignora o RLS por padrão;
--    o RLS protege o acesso direto pelo cliente (anon / authenticated).
-- =====================================================================

create extension if not exists btree_gist;

-- intervalo de horas do dia (o PostgreSQL não traz um tipo range para time)
create type public.timerange as range (subtype = time);

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) >= 3),
  email text not null,
  telefone text,
  tipo text not null check (tipo in ('PACIENTE','MEDICO','RECEPCIONISTA','ADMIN','FINANCEIRO','LABORATORIO','FARMACIA')),
  ativo boolean not null default true,
  troca_senha_obrigatoria boolean not null default false,
  recuperacao_solicitada boolean not null default false,
  criado_em timestamptz not null default now()
);
create unique index ux_usuarios_email on public.usuarios (lower(email));

create table public.convenios (
  id bigint generated always as identity primary key,
  nome text not null unique,
  registro_ans text check (registro_ans ~ '^\d{6}$')
);

create table public.especialidades (
  id bigint generated always as identity primary key,
  nome text not null unique
);

create table public.medicos (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  crm text not null check (crm ~ '^\d{4,7}$'),
  crm_uf char(2) not null check (crm_uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  crm_verificado boolean not null default false,
  unique (crm, crm_uf)
);

create table public.pacientes (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  cpf text not null unique check (cpf ~ '^\d{11}$'),
  data_nascimento date not null,
  convenio_id bigint references public.convenios (id),
  numero_carteirinha text,
  check (convenio_id is null or numero_carteirinha is not null)
);
create index ix_pacientes_convenio on public.pacientes (convenio_id);

create table public.medico_especialidade (
  medico_id uuid not null references public.medicos (usuario_id) on delete cascade,
  especialidade_id bigint not null references public.especialidades (id) on delete cascade,
  primary key (medico_id, especialidade_id)
);
create index ix_medico_esp_especialidade on public.medico_especialidade (especialidade_id);

create table public.disponibilidades (
  id bigint generated always as identity primary key,
  medico_id uuid not null references public.medicos (usuario_id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fim time not null,
  duracao_min integer not null default 30 check (duracao_min between 5 and 240),
  check (hora_inicio < hora_fim),
  -- períodos do mesmo médico no mesmo dia não podem se sobrepor
  constraint sem_sobreposicao exclude using gist (
    medico_id with =, dia_semana with =,
    public.timerange(hora_inicio, hora_fim, '[)') with &&
  )
);

create table public.consultas (
  id bigint generated always as identity primary key,
  paciente_id uuid not null references public.pacientes (usuario_id),
  medico_id uuid not null references public.medicos (usuario_id),
  data_hora timestamptz not null,
  tipo text not null default 'NORMAL' check (tipo in ('NORMAL','ENCAIXE','RETORNO')),
  status text not null default 'AGENDADA' check (status in ('AGENDADA','CONFIRMADA','EM_ESPERA','EM_ATENDIMENTO','FINALIZADA','CANCELADA','FALTOU')),
  check_in_em timestamptz,
  atraso_min integer not null default 0 check (atraso_min >= 0),
  anotacoes text,
  motivo_cancelamento text,
  iniciada_em timestamptz,
  finalizada_em timestamptz,
  criado_em timestamptz not null default now()
);
-- Meta do TAP: zero agendamentos duplicados. Encaixes são a exceção prevista.
create unique index ux_consulta_medico_horario on public.consultas (medico_id, data_hora)
  where status not in ('CANCELADA','FALTOU') and tipo <> 'ENCAIXE';
create unique index ux_consulta_paciente_horario on public.consultas (paciente_id, data_hora)
  where status not in ('CANCELADA','FALTOU');
-- um médico só tem um atendimento em andamento por vez
create unique index ux_um_atendimento_por_medico on public.consultas (medico_id)
  where status = 'EM_ATENDIMENTO';
create index ix_consulta_data on public.consultas (data_hora);
create index ix_consulta_paciente on public.consultas (paciente_id);
create index ix_consulta_medico_data on public.consultas (medico_id, data_hora);

create table public.lista_espera (
  id bigint generated always as identity primary key,
  paciente_id uuid not null references public.pacientes (usuario_id),
  especialidade_id bigint not null references public.especialidades (id),
  data_solicitacao timestamptz not null default now(),
  prioridade smallint not null default 0 check (prioridade between 0 and 2),
  ativo boolean not null default true,
  observacao text check (length(observacao) <= 300)
);
create unique index ux_lista_espera_ativa on public.lista_espera (paciente_id, especialidade_id) where ativo;
create index ix_lista_espera_especialidade on public.lista_espera (especialidade_id) where ativo;

create table public.prontuarios (
  id bigint generated always as identity primary key,
  paciente_id uuid not null unique references public.pacientes (usuario_id),
  alergias text,
  observacoes text
);

create table public.documentos_medicos (
  id bigint generated always as identity primary key,
  prontuario_id bigint not null references public.prontuarios (id),
  consulta_id bigint references public.consultas (id),
  medico_id uuid references public.medicos (usuario_id),
  tipo text not null check (tipo in ('RECEITA','ATESTADO')),
  conteudo text not null check (length(conteudo) between 5 and 5000),
  data_emissao date not null default current_date,
  data_retirada date,
  check (data_retirada is null or tipo = 'RECEITA')
);
create index ix_doc_prontuario on public.documentos_medicos (prontuario_id);
create index ix_doc_consulta on public.documentos_medicos (consulta_id);
create index ix_doc_medico on public.documentos_medicos (medico_id);

create table public.exames (
  id bigint generated always as identity primary key,
  prontuario_id bigint not null references public.prontuarios (id),
  consulta_id bigint not null references public.consultas (id),
  tipo text not null check (length(trim(tipo)) >= 2),
  status text not null default 'SOLICITADO' check (status in ('SOLICITADO','COLETADO','CONCLUIDO')),
  data_solicitacao date not null default current_date,
  data_resultado date,
  arquivo_resultado text,   -- caminho do arquivo no bucket 'resultados-exames' (ver 0002)
  arquivo_nome text,
  prazo_retorno_dias integer check (prazo_retorno_dias between 1 and 365),
  check (status <> 'CONCLUIDO' or (arquivo_resultado is not null and data_resultado is not null))
);
create index ix_exame_prontuario on public.exames (prontuario_id);
create index ix_exame_consulta on public.exames (consulta_id);

create table public.boletos (
  id bigint generated always as identity primary key,
  consulta_id bigint not null unique references public.consultas (id),
  convenio_id bigint references public.convenios (id),
  valor numeric(10,2) not null check (valor >= 0),
  vencimento date not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PAGO','CANCELADO'))
);
create index ix_boleto_status on public.boletos (status, vencimento);

create table public.log_alteracoes (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.usuarios (id),
  entidade text not null,
  registro_id bigint,
  acao text not null,
  detalhes jsonb,
  data_hora timestamptz not null default now()
);
create index ix_log_entidade on public.log_alteracoes (entidade, data_hora desc);

create table public.notificacoes (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  titulo text not null,
  mensagem text not null,
  link text,
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index ix_notificacao_usuario on public.notificacoes (usuario_id, lida, criado_em desc);

-- ---------------------------------------------------------------------
-- Funções de apoio (security definer: leem usuarios/consultas sem
-- depender das políticas, evitando recursão no RLS)
-- ---------------------------------------------------------------------
create function public.perfil_atual() returns text
language sql stable security definer set search_path = ''
as $$ select tipo from public.usuarios where id = auth.uid() and ativo $$;

-- id do usuário logado, mas só se a conta estiver ativa: desativar um usuário corta o
-- acesso na hora, mesmo que o JWT dele ainda não tenha expirado
create function public.uid_ativo() returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.usuarios where id = auth.uid() and ativo $$;

create function public.eh_recepcao() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.perfil_atual() in ('RECEPCIONISTA','ADMIN'), false) $$;

create function public.eh_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.perfil_atual() = 'ADMIN', false) $$;

-- o médico logado tem (ou teve) consulta com este paciente
create function public.medico_atende(p_paciente uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.perfil_atual() = 'MEDICO'
     and exists (select 1 from public.consultas c where c.medico_id = auth.uid() and c.paciente_id = p_paciente)
$$;

-- ---------------------------------------------------------------------
-- Regras no banco (triggers)
-- ---------------------------------------------------------------------

-- Ciclo da consulta: AGENDADA → CONFIRMADA → EM_ESPERA → EM_ATENDIMENTO → FINALIZADA
create function public.validar_transicao_consulta() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
       (old.status = 'AGENDADA'       and new.status in ('CONFIRMADA','EM_ESPERA','CANCELADA','FALTOU'))
    or (old.status = 'CONFIRMADA'     and new.status in ('AGENDADA','EM_ESPERA','CANCELADA','FALTOU'))
    or (old.status = 'EM_ESPERA'      and new.status in ('EM_ATENDIMENTO','CANCELADA'))
    or (old.status = 'EM_ATENDIMENTO' and new.status in ('FINALIZADA','EM_ESPERA'))
  ) then
    raise exception 'Transição de status inválida: % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_transicao_consulta before update of status on public.consultas
  for each row execute function public.validar_transicao_consulta();

-- Quem não é service_role/administrador não promove o próprio perfil nem reativa a conta.
create function public.proteger_usuarios() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.eh_admin() then
    if new.id <> old.id or new.tipo <> old.tipo or new.ativo <> old.ativo
       or new.troca_senha_obrigatoria <> old.troca_senha_obrigatoria
       or new.recuperacao_solicitada <> old.recuperacao_solicitada then
      raise exception 'Sem permissão para alterar perfil ou situação da conta.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
create trigger trg_proteger_usuarios before update on public.usuarios
  for each row execute function public.proteger_usuarios();

-- Paciente edita convênio/carteirinha, mas CPF e nascimento só a recepção altera.
create function public.proteger_pacientes() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.eh_recepcao() then
    if new.cpf <> old.cpf or new.data_nascimento <> old.data_nascimento then
      raise exception 'CPF e data de nascimento só podem ser alterados pela recepção.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
create trigger trg_proteger_pacientes before update on public.pacientes
  for each row execute function public.proteger_pacientes();

-- Rastreabilidade: o log não pode ser alterado nem apagado (nem pelo service_role).
create function public.log_imutavel() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'O histórico de alterações é imutável.' using errcode = 'insufficient_privilege';
end $$;
create trigger trg_log_imutavel before update or delete on public.log_alteracoes
  for each row execute function public.log_imutavel();

-- ---------------------------------------------------------------------
-- Farmácia: só encontra receitas por CPF ou número da receita
-- ---------------------------------------------------------------------
create function public.buscar_receitas(p_busca text)
returns table (id bigint, conteudo text, data_emissao date, data_retirada date, paciente_nome text, paciente_cpf text, medico_nome text, crm text, crm_uf char(2))
language plpgsql stable security definer set search_path = ''
as $$
declare
  dig text := regexp_replace(coalesce(p_busca, ''), '\D', '', 'g');
begin
  if public.perfil_atual() is distinct from 'FARMACIA' then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  if dig = '' then
    return;
  end if;
  return query
    select d.id, d.conteudo, d.data_emissao, d.data_retirada, up.nome, p.cpf, um.nome, m.crm, m.crm_uf
    from public.documentos_medicos d
    join public.prontuarios pr on pr.id = d.prontuario_id
    join public.pacientes p on p.usuario_id = pr.paciente_id
    join public.usuarios up on up.id = pr.paciente_id
    left join public.usuarios um on um.id = d.medico_id
    left join public.medicos m on m.usuario_id = d.medico_id
    where d.tipo = 'RECEITA'
      and (p.cpf = dig or d.id::text = dig)
    order by d.id desc
    limit 100;
end $$;

create function public.registrar_retirada(p_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  atual date;
begin
  if public.perfil_atual() is distinct from 'FARMACIA' then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;
  select data_retirada into atual from public.documentos_medicos where id = p_id and tipo = 'RECEITA' for update;
  if not found then
    raise exception 'Receita não encontrada.' using errcode = 'no_data_found';
  end if;
  if atual is not null then
    raise exception 'Esta receita já foi retirada em %.', to_char(atual, 'DD/MM/YYYY') using errcode = 'unique_violation';
  end if;
  update public.documentos_medicos set data_retirada = current_date where id = p_id;
  insert into public.log_alteracoes (usuario_id, entidade, registro_id, acao)
    values (auth.uid(), 'documentos_medicos', p_id, 'REGISTROU_RETIRADA');
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.usuarios enable row level security;
alter table public.convenios enable row level security;
alter table public.especialidades enable row level security;
alter table public.medicos enable row level security;
alter table public.pacientes enable row level security;
alter table public.medico_especialidade enable row level security;
alter table public.disponibilidades enable row level security;
alter table public.consultas enable row level security;
alter table public.lista_espera enable row level security;
alter table public.prontuarios enable row level security;
alter table public.documentos_medicos enable row level security;
alter table public.exames enable row level security;
alter table public.boletos enable row level security;
alter table public.log_alteracoes enable row level security;
alter table public.notificacoes enable row level security;

-- catálogo público (cadastro e busca de horários)
create policy catalogo_leitura on public.especialidades for select to anon, authenticated using (true);
create policy catalogo_leitura on public.convenios for select to anon, authenticated using (true);
create policy catalogo_admin on public.especialidades for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy catalogo_admin on public.convenios for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- usuarios: o próprio, a equipe da recepção, médicos (diretório), e quem atende/cobra o paciente
create policy usuarios_leitura on public.usuarios for select to authenticated using (
  id = public.uid_ativo()
  or public.eh_recepcao()
  or tipo = 'MEDICO'
  or public.medico_atende(id)
  or (public.perfil_atual() in ('FINANCEIRO','LABORATORIO') and tipo = 'PACIENTE')
);
create policy usuarios_edicao_propria on public.usuarios for update to authenticated
  using (id = public.uid_ativo()) with check (id = public.uid_ativo());
create policy usuarios_admin on public.usuarios for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- medicos: diretório visível; cadastro e verificação do CRM só o administrador
create policy medicos_leitura on public.medicos for select to authenticated using (true);
create policy medicos_admin on public.medicos for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy medico_esp_leitura on public.medico_especialidade for select to anon, authenticated using (true);
create policy medico_esp_admin on public.medico_especialidade for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- pacientes
create policy pacientes_leitura on public.pacientes for select to authenticated using (
  usuario_id = public.uid_ativo() or public.eh_recepcao() or public.perfil_atual() = 'FINANCEIRO' or public.medico_atende(usuario_id)
);
create policy pacientes_edicao on public.pacientes for update to authenticated
  using (usuario_id = public.uid_ativo() or public.eh_recepcao()) with check (usuario_id = public.uid_ativo() or public.eh_recepcao());
create policy pacientes_cadastro on public.pacientes for insert to authenticated with check (public.eh_recepcao());

-- agenda do médico
create policy disp_leitura on public.disponibilidades for select to authenticated using (true);
create policy disp_gestao on public.disponibilidades for all to authenticated
  using (medico_id = public.uid_ativo() or public.eh_recepcao()) with check (medico_id = public.uid_ativo() or public.eh_recepcao());

-- consultas
create policy consultas_leitura on public.consultas for select to authenticated using (
  paciente_id = public.uid_ativo() or medico_id = public.uid_ativo() or public.eh_recepcao() or public.perfil_atual() = 'FINANCEIRO'
);
create policy consultas_agendar on public.consultas for insert to authenticated with check (
  (paciente_id = public.uid_ativo() and public.perfil_atual() = 'PACIENTE' and tipo <> 'ENCAIXE' and status = 'AGENDADA')
  or public.eh_recepcao()
);
create policy consultas_recepcao on public.consultas for update to authenticated
  using (public.eh_recepcao()) with check (public.eh_recepcao());
create policy consultas_medico on public.consultas for update to authenticated
  using (medico_id = public.uid_ativo() and public.perfil_atual() = 'MEDICO')
  with check (medico_id = public.uid_ativo() and status in ('EM_ESPERA','EM_ATENDIMENTO','FINALIZADA'));
create policy consultas_paciente on public.consultas for update to authenticated
  using (paciente_id = public.uid_ativo() and public.perfil_atual() = 'PACIENTE')
  with check (paciente_id = public.uid_ativo() and status in ('AGENDADA','CONFIRMADA','CANCELADA'));

-- lista de espera
create policy espera_leitura on public.lista_espera for select to authenticated using (paciente_id = public.uid_ativo() or public.eh_recepcao());
create policy espera_entrar on public.lista_espera for insert to authenticated with check (
  (paciente_id = public.uid_ativo() and prioridade = 0) or public.eh_recepcao()
);
create policy espera_sair on public.lista_espera for update to authenticated
  using (paciente_id = public.uid_ativo() or public.eh_recepcao())
  with check (public.eh_recepcao() or (paciente_id = public.uid_ativo() and prioridade = 0));

-- dados clínicos: só o paciente e o médico que o atende (recepção, financeiro e administrador não leem)
create policy prontuario_leitura on public.prontuarios for select to authenticated using (paciente_id = public.uid_ativo() or public.medico_atende(paciente_id));
create policy prontuario_escrita on public.prontuarios for update to authenticated using (public.medico_atende(paciente_id)) with check (public.medico_atende(paciente_id));
create policy prontuario_criar on public.prontuarios for insert to authenticated with check (public.medico_atende(paciente_id) or public.eh_recepcao());

create policy doc_leitura on public.documentos_medicos for select to authenticated using (
  medico_id = public.uid_ativo()
  or exists (select 1 from public.prontuarios pr where pr.id = prontuario_id and (pr.paciente_id = public.uid_ativo() or public.medico_atende(pr.paciente_id)))
);
create policy doc_emitir on public.documentos_medicos for insert to authenticated with check (
  medico_id = public.uid_ativo() and public.perfil_atual() = 'MEDICO'
  and exists (
    select 1 from public.consultas c join public.prontuarios pr on pr.paciente_id = c.paciente_id
    where c.id = consulta_id and pr.id = prontuario_id and c.medico_id = public.uid_ativo() and c.status in ('EM_ATENDIMENTO','FINALIZADA'))
);

create policy exame_leitura on public.exames for select to authenticated using (
  public.perfil_atual() = 'LABORATORIO'
  or exists (select 1 from public.consultas c where c.id = consulta_id and c.medico_id = public.uid_ativo())
  or exists (select 1 from public.prontuarios pr where pr.id = prontuario_id and pr.paciente_id = public.uid_ativo())
);
create policy exame_solicitar on public.exames for insert to authenticated with check (
  public.perfil_atual() = 'MEDICO'
  and exists (
    select 1 from public.consultas c join public.prontuarios pr on pr.paciente_id = c.paciente_id
    where c.id = consulta_id and pr.id = prontuario_id and c.medico_id = public.uid_ativo() and c.status in ('EM_ATENDIMENTO','FINALIZADA'))
);
create policy exame_laboratorio on public.exames for update to authenticated
  using (public.perfil_atual() = 'LABORATORIO') with check (public.perfil_atual() = 'LABORATORIO');

-- financeiro
create policy boleto_leitura on public.boletos for select to authenticated using (
  public.perfil_atual() in ('FINANCEIRO','ADMIN')
  or exists (select 1 from public.consultas c where c.id = consulta_id and c.paciente_id = public.uid_ativo())
);
create policy boleto_gestao on public.boletos for all to authenticated
  using (public.perfil_atual() in ('FINANCEIRO','ADMIN')) with check (public.perfil_atual() in ('FINANCEIRO','ADMIN'));

-- log: só o administrador lê; qualquer usuário registra ações em seu próprio nome
create policy log_leitura on public.log_alteracoes for select to authenticated using (public.eh_admin());
create policy log_registrar on public.log_alteracoes for insert to authenticated with check (usuario_id = public.uid_ativo());

-- notificações: cada um vê e marca como lida só as suas (quem cria é o backend)
create policy notif_leitura on public.notificacoes for select to authenticated using (usuario_id = public.uid_ativo());
create policy notif_marcar on public.notificacoes for update to authenticated using (usuario_id = public.uid_ativo()) with check (usuario_id = public.uid_ativo());

-- ---------------------------------------------------------------------
-- Permissões das funções e tempo real
-- ---------------------------------------------------------------------
revoke execute on function public.buscar_receitas(text), public.registrar_retirada(bigint) from public, anon;
grant execute on function public.buscar_receitas(text), public.registrar_retirada(bigint) to authenticated;

-- Realtime do Supabase substitui os eventos SSE (só existe no Supabase)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.consultas, public.notificacoes, public.lista_espera;
  end if;
end $$;
