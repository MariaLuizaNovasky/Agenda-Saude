-- Catálogo inicial (os mesmos dados do seed do SQLite). Usuários, pacientes e médicos
-- precisam ser criados pelo Supabase Auth, por isso não estão aqui.
insert into public.especialidades (nome) values
  ('Clínica Geral'), ('Cardiologia'), ('Dermatologia'), ('Ortopedia'), ('Pediatria'), ('Ginecologia')
on conflict (nome) do nothing;

insert into public.convenios (nome, registro_ans) values
  ('Saúde+', '412345'), ('Vida Plena', '398765'), ('Bem Cuidar', '401122')
on conflict (nome) do nothing;
