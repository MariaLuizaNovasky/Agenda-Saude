import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const processos = [
  {
    nome: 'API',
    diretorio: path.join(raiz, 'backend'),
    script: path.join(raiz, 'backend', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    args: ['src/server.ts'],
  },
  {
    nome: 'Frontend',
    diretorio: path.join(raiz, 'frontend'),
    script: path.join(raiz, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
    args: ['--host', '127.0.0.1', '--strictPort'],
  },
];

const filhos = [];
let encerrando = false;

function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const filho of filhos) {
    if (filho.exitCode === null) filho.kill();
  }
  process.exitCode = codigo;
}

for (const processo of processos) {
  const filho = spawn(process.execPath, [processo.script, ...processo.args], {
    cwd: processo.diretorio,
    stdio: 'inherit',
  });
  filhos.push(filho);
  filho.on('error', (erro) => {
    console.error(`[${processo.nome}] Não foi possível iniciar: ${erro.message}`);
    encerrar(1);
  });
  filho.on('exit', (codigo) => {
    if (!encerrando) {
      console.error(`[${processo.nome}] encerrou${codigo === null ? '' : ` (código ${codigo})`}.`);
      encerrar(codigo ?? 1);
    }
  });
}

console.log('Agenda-Saúde disponível em http://localhost:5173');
console.log('API em http://localhost:3333/api/saude');
process.on('SIGINT', () => encerrar());
process.on('SIGTERM', () => encerrar());
