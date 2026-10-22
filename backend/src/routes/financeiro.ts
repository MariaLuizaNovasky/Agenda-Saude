import { Router } from 'express';
import { z } from 'zod';
import { permitir } from '../auth.js';
import { all, one, run } from '../db.js';
import { auditar, HttpError, hojeISO, idParam, naoEncontrado, notificar, somarDias, validar } from '../util.js';

export const financeiroRouter = Router();

const SQL_BOLETO = `
  SELECT b.*, c.data_hora, c.tipo AS consulta_tipo, c.paciente_id, up.nome AS paciente_nome, p.cpf AS paciente_cpf,
         um.nome AS medico_nome, cv.nome AS convenio_nome,
         CASE WHEN b.status = 'PENDENTE' AND b.vencimento < date('now','localtime') THEN 1 ELSE 0 END AS vencido
  FROM boletos b
  JOIN consultas c ON c.id = b.consulta_id
  JOIN pacientes p ON p.usuario_id = c.paciente_id
  JOIN usuarios up ON up.id = c.paciente_id
  JOIN usuarios um ON um.id = c.medico_id
  LEFT JOIN convenios cv ON cv.id = b.convenio_id`;

// Consultar boletos (paciente: os próprios) / gerenciar boletos (financeiro e administrador)
financeiroRouter.get('/boletos', permitir('PACIENTE', 'FINANCEIRO', 'ADMIN'), (req, res) => {
  const f: string[] = [];
  const p: (string | number)[] = [];
  if (req.usuario.tipo === 'PACIENTE') { f.push('c.paciente_id = ?'); p.push(req.usuario.id); }
  const { status, busca, tipo } = req.query as Record<string, string | undefined>;
  if (status) { f.push('b.status = ?'); p.push(status); }
  if (tipo === 'CONVENIO') f.push('b.convenio_id IS NOT NULL');
  if (tipo === 'PARTICULAR') f.push('b.convenio_id IS NULL');
  if (busca) { f.push('(up.nome LIKE ? OR p.cpf LIKE ?)'); p.push(`%${busca}%`, `%${busca.replace(/\D/g, '') || busca}%`); }
  res.json(all(`${SQL_BOLETO} ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY b.status = 'PENDENTE' DESC, b.vencimento DESC LIMIT 500`, ...p));
});

// Boleto.gerar(): para consultas finalizadas que ainda não têm cobrança
financeiroRouter.post('/boletos', permitir('FINANCEIRO', 'ADMIN'), (req, res) => {
  const d = validar(
    z.object({
      consulta_id: z.number().int().positive(),
      valor: z.number().min(0, 'O valor não pode ser negativo.'),
      vencimento: z.iso.date('Informe o vencimento.'),
    }),
    req.body,
  );
  const c = one<{ status: string; paciente_id: number }>('SELECT status, paciente_id FROM consultas WHERE id = ?', d.consulta_id);
  if (!c) throw naoEncontrado('Consulta');
  if (c.status !== 'FINALIZADA') throw new HttpError(400, 'Só consultas finalizadas geram cobrança.');
  const conv = one<{ convenio_id: number | null }>('SELECT convenio_id FROM pacientes WHERE usuario_id = ?', c.paciente_id)!;
  const { id } = run(
    'INSERT INTO boletos (consulta_id, convenio_id, valor, vencimento) VALUES (?,?,?,?)',
    d.consulta_id, conv.convenio_id, d.valor, d.vencimento,
  );
  auditar(req.usuario.id, 'boletos', id, 'GEROU', d);
  res.status(201).json({ id });
});

financeiroRouter.put('/boletos/:id', permitir('FINANCEIRO', 'ADMIN'), (req, res) => {
  const id = idParam(req);
  const d = validar(z.object({ valor: z.number().min(0), vencimento: z.iso.date() }), req.body);
  const b = one<{ status: string }>('SELECT status FROM boletos WHERE id = ?', id);
  if (!b) throw naoEncontrado('Boleto');
  if (b.status !== 'PENDENTE') throw new HttpError(400, 'Só boletos pendentes podem ser alterados.');
  run('UPDATE boletos SET valor = ?, vencimento = ? WHERE id = ?', d.valor, d.vencimento, id);
  auditar(req.usuario.id, 'boletos', id, 'EDITOU', d);
  res.json({ ok: true });
});

// Boleto.darBaixa()
financeiroRouter.post('/boletos/:id/baixa', permitir('FINANCEIRO', 'ADMIN'), (req, res) => {
  const id = idParam(req);
  const b = one<{ status: string; paciente_id: number }>(`${SQL_BOLETO} WHERE b.id = ?`, id);
  if (!b) throw naoEncontrado('Boleto');
  if (b.status !== 'PENDENTE') throw new HttpError(400, 'Este boleto não está pendente.');
  run("UPDATE boletos SET status = 'PAGO' WHERE id = ?", id);
  auditar(req.usuario.id, 'boletos', id, 'DEU_BAIXA');
  notificar(b.paciente_id, 'Pagamento confirmado', `O boleto nº ${id} foi registrado como pago.`, '/boletos');
  res.json({ ok: true });
});

// Boleto.cancelar()
financeiroRouter.post('/boletos/:id/cancelar', permitir('FINANCEIRO', 'ADMIN'), (req, res) => {
  const id = idParam(req);
  const b = one<{ status: string }>('SELECT status FROM boletos WHERE id = ?', id);
  if (!b) throw naoEncontrado('Boleto');
  if (b.status !== 'PENDENTE') throw new HttpError(400, 'Só boletos pendentes podem ser cancelados.');
  run("UPDATE boletos SET status = 'CANCELADO' WHERE id = ?", id);
  auditar(req.usuario.id, 'boletos', id, 'CANCELOU');
  res.json({ ok: true });
});

/* -------------------------------- dashboard -------------------------------- */

// Visualizar dashboard e indicadores
financeiroRouter.get('/dashboard', permitir('RECEPCIONISTA', 'ADMIN', 'FINANCEIRO'), (req, res) => {
  const data = typeof req.query.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data) ? req.query.data : hojeISO();
  const dia = one(
    `SELECT count(*) AS total,
            coalesce(sum(status = 'AGENDADA'),0) AS agendadas,
            coalesce(sum(status IN ('CONFIRMADA','EM_ESPERA')),0) AS aguardando,
            coalesce(sum(status = 'EM_ATENDIMENTO'),0) AS em_atendimento,
            coalesce(sum(status = 'FINALIZADA'),0) AS finalizadas,
            coalesce(sum(status = 'CANCELADA'),0) AS canceladas,
            coalesce(sum(status = 'FALTOU'),0) AS faltas,
            coalesce(sum(tipo = 'ENCAIXE' AND status <> 'CANCELADA'),0) AS encaixes,
            coalesce(sum(atraso_min > 0 AND status NOT IN ('CANCELADA','FALTOU')),0) AS com_atraso,
            round(avg(CASE WHEN check_in_em IS NOT NULL AND iniciada_em IS NOT NULL
                 THEN (julianday(iniciada_em) - julianday(check_in_em)) * 1440 END), 0) AS espera_media_min
     FROM consultas WHERE substr(data_hora,1,10) = ?`,
    data,
  );
  const inicio = somarDias(data, -6);
  const semana = all(
    `WITH RECURSIVE dias(d) AS (SELECT ? UNION ALL SELECT date(d, '+1 day') FROM dias WHERE d < ?)
     SELECT d AS data,
            (SELECT count(*) FROM consultas WHERE substr(data_hora,1,10) = d AND status NOT IN ('CANCELADA')) AS consultas,
            (SELECT count(*) FROM consultas WHERE substr(data_hora,1,10) = d AND status = 'FALTOU') AS faltas
     FROM dias`,
    inicio, data,
  );
  const porMedico = all(
    `SELECT u.nome AS medico_nome, count(c.id) AS consultas,
            coalesce(sum(c.status = 'FINALIZADA'),0) AS finalizadas,
            max(coalesce(c.atraso_min,0)) AS atraso_min
     FROM medicos m JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN consultas c ON c.medico_id = m.usuario_id AND substr(c.data_hora,1,10) = ? AND c.status NOT IN ('CANCELADA')
     WHERE u.ativo = 1 GROUP BY m.usuario_id ORDER BY consultas DESC, u.nome`,
    data,
  );
  const outros = one(
    `SELECT (SELECT count(*) FROM lista_espera WHERE ativo = 1) AS lista_espera,
            (SELECT count(*) FROM boletos WHERE status = 'PENDENTE') AS boletos_pendentes,
            (SELECT coalesce(sum(valor),0) FROM boletos WHERE status = 'PENDENTE') AS valor_pendente,
            (SELECT count(*) FROM boletos WHERE status = 'PENDENTE' AND vencimento < date('now','localtime')) AS boletos_vencidos,
            (SELECT count(*) FROM exames WHERE status <> 'CONCLUIDO') AS exames_em_andamento,
            (SELECT count(*) FROM pacientes) AS pacientes`,
  );
  res.json({ data, dia, semana, porMedico, ...outros });
});
