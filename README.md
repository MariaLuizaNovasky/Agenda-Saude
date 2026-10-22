# Agenda-Saúde

Sistema de agendamento médico com gestão de pacientes, médicos, agendas e fila de atendimento em tempo real. Inclui controle de atrasos, check-in, encaixes, lista de espera e dashboard com indicadores. Projeto acadêmico.

```
Agenda-Saude/
├── backend/    API REST em Node + Express + TypeScript, banco SQLite local
├── frontend/   Interface web em React + TypeScript (Vite)
└── *.drawio    Diagramas (casos de uso, atividades, classes e banco de dados)
```

## Como rodar

Pré-requisito: **Node.js 22.13 ou mais novo** (usa o SQLite embutido no Node).

Abra dois terminais.

```bash
# terminal 1: API (http://localhost:3333/api)
cd backend
npm install
npm run dev
```

```bash
# terminal 2: interface (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Na primeira execução o banco é criado em `backend/data/` com dados fictícios. Para recomeçar do zero: `cd backend && npm run seed`.

## Contas de demonstração

Senha de todas: `Senha123`

| Perfil | E-mail |
|---|---|
| Paciente | paciente@agendasaude.com |
| Recepção | recepcao@agendasaude.com |
| Médica | helena@agendasaude.com (também rafael@, camila@, bruno@) |
| Administrador | admin@agendasaude.com |
| Financeiro | financeiro@agendasaude.com |
| Laboratório | laboratorio@agendasaude.com |
| Farmácia | farmacia@agendasaude.com |

A tela de login tem atalhos que preenchem essas contas.

## Roteiro para demonstrar o fluxo do diagrama de atividades

1. **Paciente** (Ana) entra, vê a consulta de hoje e faz o **check-in**. Em *Fila de atendimento* aparece "Aguarde".
2. **Recepção**, em outra janela, abre *Fila* e clica **Confirmar** na Ana. A tela da paciente muda sozinha para a posição na fila.
3. **Médica** (Helena) abre *Meus atendimentos*, finaliza o atendimento em curso e chama a Ana. Registra anotações, emite receita e **pede exame com prazo de retorno**, depois finaliza.
4. **Laboratório** registra a coleta e **anexa o resultado** (PDF/PNG/JPG). A paciente recebe o aviso.
5. **Paciente** vê o resultado no *Histórico* e agenda o **retorno** pelo atalho do *Início*.
6. **Farmácia** busca pelo CPF da paciente (123.456.789-09) e registra a retirada da receita.
7. **Financeiro** dá baixa no boleto gerado ao finalizar a consulta.
8. **Administrador** acompanha *Indicadores*, *Relatórios* e o *Histórico de alterações*.

## Metas do TAP e onde estão atendidas

| Meta | Como o sistema garante |
|---|---|
| 0 agendamentos duplicados | índice único no banco por médico + horário (e por paciente + horário), além da validação na API. Encaixes são a exceção prevista. |
| Nenhum acesso indevido entre perfis | cada rota da API checa o perfil e o dono do dado (paciente só vê o que é dele; médico só vê prontuário de quem atende; recepção não vê dados clínicos; farmácia só vê receitas buscando por CPF ou número). |
| Dados persistidos após nova sessão | banco SQLite em arquivo (`backend/data`). |
| Fila atualizada entre sessões em até 5 s | eventos em tempo real (Server-Sent Events): toda mudança em consulta avisa as telas abertas, que recarregam em menos de 1 s. |
| Recuperação de senha via administrador | pedido vai ao administrador, que gera senha temporária; a troca é obrigatória no próximo login. |
| CRM com UF e verificação | formato validado (4 a 7 dígitos + UF) e confirmação manual pelo administrador. |
| Rastreabilidade | tabela `log_alteracoes` registra quem fez o quê em cada ação. |

## Migração futura para o Supabase

As tabelas seguem o `Diagrama BD.drawio` (com poucos campos a mais, comentados em `backend/src/db.ts`). Para migrar: recriar o esquema no PostgreSQL do Supabase, trocar as regras de acesso das rotas por políticas RLS, usar o Supabase Auth no lugar do JWT próprio, o Storage no lugar da pasta `uploads/` e o Realtime no lugar dos eventos SSE.
