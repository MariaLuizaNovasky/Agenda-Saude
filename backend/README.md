# Backend: API do Agenda-Saúde

Node + Express 5 + TypeScript, banco SQLite (módulo `node:sqlite`, embutido no Node 22.13+).

```bash
npm install
npm run dev      # sobe em http://localhost:3333/api e recarrega ao salvar
npm run seed     # apaga e recria os dados fictícios
npm run typecheck
```

Configuração opcional: copie `.env.example` para `.env` (porta, segredo do JWT, caminho do banco, valor da consulta).

O Node mostra um aviso de que o SQLite é "experimental"; é esperado e não afeta o funcionamento.

## Estrutura

```
src/
├── server.ts        monta a API e cria os dados de demonstração se o banco estiver vazio
├── db.ts            esquema das tabelas (Diagrama BD) e funções de acesso
├── auth.ts          JWT e checagem de perfil
├── agenda.ts        geração de horários, bloqueio de duplicidade, montagem da fila
├── events.ts        tempo real (Server-Sent Events)
├── util.ts          erros, auditoria, notificações, validação de CPF/CRM
├── seed.ts          dados fictícios
└── routes/
    ├── auth.ts        login, cadastro do paciente, recuperação e troca de senha
    ├── admin.ts       usuários e permissões, especialidades, convênios, relatórios
    ├── pessoas.ts     médicos, disponibilidade, atraso, pacientes, notificações
    ├── consultas.ts   agendar, remarcar, cancelar, check-in, fila, atendimento, lista de espera
    ├── clinico.ts     prontuário, receitas/atestados, exames, retornos
    └── financeiro.ts  boletos e indicadores
```

## Perfis

`PACIENTE`, `RECEPCIONISTA`, `MEDICO`, `ADMIN` (herda a recepção), `FINANCEIRO`, `LABORATORIO`, `FARMACIA`.

## Ciclo da consulta (StatusConsulta)

`AGENDADA` → check-in do paciente → `CONFIRMADA` → recepção confirma presença → `EM_ESPERA` → médico inicia → `EM_ATENDIMENTO` → `FINALIZADA` (gera boleto). Saídas: `CANCELADA` (avisa a lista de espera) e `FALTOU`.
