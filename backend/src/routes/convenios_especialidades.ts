import { supabase } from '../supabase.js';
import { HttpError } from '../util.js';

interface FastifyInstance {
  get(path: string, handler: (...args: never[]) => unknown): unknown;
  post<TBody>(
    path: string,
    handler: (
      request: { body: TBody },
      reply: { code(status: number): { send(data: unknown): unknown } },
    ) => unknown,
  ): unknown;
}

interface ConvenioInput {
  nome: string;
  registro_ans: string;
}

export async function conveniosEspecialidadesRoutes(app: FastifyInstance) {
  // --- CONVÊNIOS ---
  app.get('/convenios', async () => {
    const { data, error } = await supabase.from('convenios').select('*').order('nome');
    if (error) throw new HttpError(500, error.message);
    return data;
  });

  app.post<ConvenioInput>('/convenios', async (request, reply) => {
    const { nome, registro_ans } = request.body;
    const { data, error } = await supabase
      .from('convenios')
      .insert([{ nome, registro_ans }])
      .select()
      .single();

    if (error) throw new HttpError(400, error.message);
    return reply.code(201).send(data);
  });

  // --- ESPECIALIDADES ---
  app.get('/especialidades', async () => {
    const { data, error } = await supabase.from('especialidades').select('*').order('nome');
    if (error) throw new HttpError(500, error.message);
    return data;
  });

  app.post<{ nome: string }>('/especialidades', async (request, reply) => {
    const { nome } = request.body;
    const { data, error } = await supabase
      .from('especialidades')
      .insert([{ nome }])
      .select()
      .single();

    if (error) throw new HttpError(400, error.message);
    return reply.code(201).send(data);
  });
}