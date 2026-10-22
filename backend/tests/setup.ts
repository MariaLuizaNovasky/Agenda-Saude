// Cada arquivo de teste roda com um banco SQLite e uma pasta de uploads novos (dados fictícios do seed).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'agenda-saude-test-'));
process.env.DB_PATH = join(dir, 'teste.db');
process.env.UPLOADS_DIR = join(dir, 'uploads');
process.env.JWT_SECRET = 'segredo-de-teste';
