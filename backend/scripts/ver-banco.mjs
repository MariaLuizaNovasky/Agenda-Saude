import { DatabaseSync } from 'node:sqlite';

const caminho = process.argv[2] ?? './data/agenda-saude.db';
const db = new DatabaseSync(caminho);

const tabelas = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((t) => t.name);

console.log(`\nBanco: ${caminho}\n`);
console.table(
  tabelas.map((nome) => ({
    tabela: nome,
    registros: db.prepare(`SELECT COUNT(*) AS n FROM "${nome}"`).get().n,
  })),
);

for (const nome of ['usuarios', 'consultas']) {
  if (!tabelas.includes(nome)) continue;
  const linhas = db.prepare(`SELECT * FROM "${nome}" LIMIT 5`).all();
  for (const l of linhas) delete l.senha_hash; // nunca mostra hash de senha
  console.log(`\nPrimeiros registros de ${nome}:`);
  console.table(linhas);
}