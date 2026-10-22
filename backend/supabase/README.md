# Banco no Supabase

```
supabase/
├── migrations/0001_agenda_saude.sql             esquema, regras no banco e RLS (testado)
├── migrations/0002_storage_resultados_exames.sql bucket privado dos resultados de exames
└── seed.sql                                      especialidades e convênios iniciais
```

## Como aplicar

**Pelo painel:** no projeto Supabase, abra *SQL Editor* e rode, nesta ordem, `0001`, `0002` e `seed.sql`.

**Pela CLI:** `supabase link --project-ref <ref>` e `supabase db push`.

## O que mudou em relação ao SQLite

| SQLite | Supabase |
|---|---|
| `usuarios.senha_hash` + JWT próprio | Supabase Auth (`usuarios.id` é o mesmo uuid de `auth.users`) |
| datas em texto local | `timestamptz`, `date`, `time` |
| regras só na API | também no banco: status da consulta só avança no ciclo previsto, 1 atendimento por vez por médico, agenda sem sobreposição, log imutável |
| checagem de perfil nas rotas | RLS em todas as tabelas + funções `buscar_receitas` e `registrar_retirada` para a farmácia |
| SSE (`events.ts`) | Realtime (`consultas`, `notificacoes`, `lista_espera` já entram na publicação) |
| pasta `uploads/` | Storage, bucket `resultados-exames` |

## Pontos de atenção

- O backend deve usar a **service_role key** (ignora o RLS). Nunca a exponha no frontend; o frontend usa só a anon key + login.
- Desativar um usuário (`usuarios.ativo = false`) corta o acesso pelo RLS na hora. Para impedir também novos logins, desative-o no Auth.
- Criar pacientes e equipe exige o Auth (`auth.admin.createUser`) e depois o `insert` em `usuarios` e nas tabelas do perfil. O `seed.sql` só traz o catálogo.
- O boleto ao finalizar a consulta continua sendo criado pelo backend.
- O `0002` precisa do schema `storage` e só roda no Supabase; os testes cobrem o `0001`.

## Testes

`npm test` roda a migração `0001` num PostgreSQL em memória (PGlite) e confere as restrições e o RLS por perfil (`tests/supabase-schema.test.ts`).
