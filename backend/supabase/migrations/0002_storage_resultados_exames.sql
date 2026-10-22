-- Bucket privado para os resultados de exames (substitui a pasta uploads/).
-- Só roda no Supabase (precisa do schema storage).
-- Convenção do caminho do arquivo: <exame_id>/<uuid>.<pdf|png|jpg|jpeg>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resultados-exames', 'resultados-exames', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- laboratório envia
create policy "laboratorio envia resultados" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resultados-exames' and public.perfil_atual() = 'LABORATORIO');

-- laboratório, médico do exame e paciente dono leem: a subconsulta em public.exames
-- já passa pelo RLS de quem está lendo, então herda a mesma regra de acesso.
create policy "le resultados de exames permitidos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'resultados-exames'
    and exists (select 1 from public.exames e where e.arquivo_resultado = storage.objects.name)
  );
