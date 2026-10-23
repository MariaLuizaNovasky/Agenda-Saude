# Frontend: interface do Agenda-Saúde

React 19 + TypeScript + Vite + React Router.

```bash
npm install
npm run dev     # http://localhost:5173 (a API precisa estar rodando na porta 3333)
npm run build   # gera a versão de produção em dist/
```

Para iniciar frontend e API juntos a partir da raiz do projeto, use `npm run dev` (no PowerShell do Windows, `npm.cmd run dev`).

Em desenvolvimento o Vite encaminha `/api` para `http://localhost:3333`. Para apontar para outra API, defina `VITE_API_URL` (veja `.env.example`).

## Navegação interna

A barra lateral pode ser recolhida no desktop e aberta no celular. As páginas do perfil atual abrem como abas dentro da mesma janela; a URL acompanha a aba ativa e rotas com identificadores diferentes ficam em abas distintas. As abas abertas são lembradas durante a sessão do navegador, e páginas visitadas permanecem montadas ao alternar entre elas. Alterações em campos de formulários são sinalizadas e uma confirmação é exibida antes de fechar a aba correspondente.

## Central de ajuda e avaliações

Pacientes podem abrir solicitações e acompanhar respostas; a recepção pode responder, resolver ou encaminhar uma solicitação ao administrador. Pacientes também podem avaliar o médico e o atendimento após consultas finalizadas. Nesta versão somente frontend, solicitações e avaliações são armazenadas no `localStorage` do navegador e não são sincronizadas com outros dispositivos nem enviadas à API.

## Estrutura

```
src/
├── App.tsx            rotas e bloqueio por perfil
├── api.ts             cliente HTTP e tipos
├── auth.tsx           sessão do usuário
├── hooks.ts           carregamento de dados e tempo real (EventSource)
├── formato.ts         datas, moeda, CPF, rótulos
├── estilos.css        visual (claro e escuro)
├── components/        layout, menu por perfil, avisos, seletor de horário, modais
└── pages/             uma tela por caso de uso
```

## Telas por perfil

- **Paciente:** início, agendar (especialidade, médico, dia e horário), minhas consultas (check-in, remarcar, cancelar), fila em tempo real, histórico (exames, receitas, atestados), lista de espera, boletos.
- **Recepção:** agenda do dia (confirmar presença, faltas, encaixe, remarcação), fila por médico e atrasos, lista de espera, retornos pendentes, pacientes, indicadores.
- **Médico:** atendimentos do dia, tela de atendimento (anotações, prontuário, receita/atestado, pedido de exame com prazo de retorno), agenda, disponibilidade, retornos, exames pedidos.
- **Administrador:** tudo da recepção, mais usuários e acessos, especialidades e convênios, boletos e relatórios com histórico de alterações.
- **Financeiro:** boletos e indicadores. **Laboratório:** exames. **Farmácia:** retirada de receitas.
