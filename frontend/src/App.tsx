import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Perfil } from './api';
import { useAuth } from './auth';
import { Layout, MENU } from './components/Layout';
import { Carregando } from './components/ui';
import { Agenda } from './pages/Agenda';
import { Agendar } from './pages/Agendar';
import { Avaliacoes } from './pages/Avaliacoes';
import { Atendimento } from './pages/Atendimento';
import { Atendimentos } from './pages/Atendimentos';
import { Boletos } from './pages/Boletos';
import { CentralAjuda } from './pages/CentralAjuda';
import { Cadastro } from './pages/Cadastro';
import { Cadastros } from './pages/Cadastros';
import { Comunicacao } from './pages/Comunicacao';
import { Dashboard } from './pages/Dashboard';
import { Disponibilidade } from './pages/Disponibilidade';
import { Entrar } from './pages/Entrar';
import { Exames } from './pages/Exames';
import { Fila } from './pages/Fila';
import { Historico } from './pages/Historico';
import { Inicio } from './pages/Inicio';
import { ListaEspera } from './pages/ListaEspera';
import { MinhasConsultas } from './pages/MinhasConsultas';
import { Pacientes } from './pages/Pacientes';
import { Perfil as PaginaPerfil } from './pages/Perfil';
import { Receitas } from './pages/Receitas';
import { RecuperarSenha } from './pages/RecuperarSenha';
import { Relatorios } from './pages/Relatorios';
import { Retornos } from './pages/Retornos';
import { TrocarSenha } from './pages/TrocarSenha';
import { Usuarios } from './pages/Usuarios';

const RECEPCAO: Perfil[] = ['RECEPCIONISTA', 'ADMIN'];
const PERFIS_INTERNOS: Perfil[] = ['RECEPCIONISTA', 'MEDICO', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'];

/** Bloqueia a rota para perfis sem permissão (o servidor também valida). */
function Para({ perfis, children }: { perfis: Perfil[]; children: ReactNode }) {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/entrar" replace />;
  if (!perfis.includes(usuario.tipo)) return <Navigate to={MENU[usuario.tipo][0].para} replace />;
  return <>{children}</>;
}

export function App() {
  const { usuario, carregando } = useAuth();
  const local = useLocation();

  if (carregando) return <div className="tela-cheia"><Carregando /></div>;

  if (!usuario) {
    return (
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/recuperar-senha" element={<RecuperarSenha />} />
        <Route path="*" element={<Navigate to="/entrar" replace state={{ de: local.pathname + local.search }} />} />
      </Routes>
    );
  }

  // senha temporária: troca obrigatória antes de usar o sistema
  if (usuario.troca_senha_obrigatoria) return <TrocarSenha obrigatoria />;

  const inicio = MENU[usuario.tipo][0].para;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/inicio" element={<Para perfis={['PACIENTE']}><Inicio /></Para>} />
        <Route path="/agendar" element={<Para perfis={['PACIENTE']}><Agendar /></Para>} />
        <Route path="/consultas" element={<Para perfis={['PACIENTE']}><MinhasConsultas /></Para>} />
        <Route path="/avaliacoes" element={<Para perfis={['PACIENTE']}><Avaliacoes /></Para>} />
        <Route path="/ajuda" element={<Para perfis={['PACIENTE', ...RECEPCAO]}><CentralAjuda /></Para>} />
        <Route path="/historico" element={<Para perfis={['PACIENTE']}><Historico /></Para>} />
        <Route path="/fila" element={<Para perfis={['PACIENTE', ...RECEPCAO]}><Fila /></Para>} />
        <Route path="/lista-espera" element={<Para perfis={['PACIENTE', ...RECEPCAO]}><ListaEspera /></Para>} />
        <Route path="/boletos" element={<Para perfis={['PACIENTE', 'FINANCEIRO', 'ADMIN']}><Boletos /></Para>} />
        <Route path="/agenda" element={<Para perfis={[...RECEPCAO, 'MEDICO']}><Agenda /></Para>} />
        <Route path="/retornos" element={<Para perfis={[...RECEPCAO, 'MEDICO']}><Retornos /></Para>} />
        <Route path="/pacientes" element={<Para perfis={RECEPCAO}><Pacientes /></Para>} />
        <Route path="/dashboard" element={<Para perfis={[...RECEPCAO, 'FINANCEIRO']}><Dashboard /></Para>} />
        <Route path="/usuarios" element={<Para perfis={['ADMIN']}><Usuarios /></Para>} />
        <Route path="/cadastros" element={<Para perfis={['ADMIN']}><Cadastros /></Para>} />
        <Route path="/relatorios" element={<Para perfis={['ADMIN']}><Relatorios /></Para>} />
        <Route path="/atendimentos" element={<Para perfis={['MEDICO']}><Atendimentos /></Para>} />
        <Route path="/atendimento/:id" element={<Para perfis={['MEDICO']}><Atendimento /></Para>} />
        <Route path="/disponibilidade" element={<Para perfis={['MEDICO']}><Disponibilidade /></Para>} />
        <Route path="/exames" element={<Para perfis={['MEDICO', 'LABORATORIO']}><Exames /></Para>} />
        <Route path="/receitas" element={<Para perfis={['FARMACIA']}><Receitas /></Para>} />
        <Route path="/perfil" element={<PaginaPerfil />} />
        <Route path="/comunicacao" element={<Para perfis={PERFIS_INTERNOS}><Comunicacao /></Para>} />
        <Route path="*" element={<Navigate to={inicio} replace />} />
      </Route>
    </Routes>
  );
}
