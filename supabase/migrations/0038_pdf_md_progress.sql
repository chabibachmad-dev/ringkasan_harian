-- Menu "PDF → MD": persen kemajuan per tugas (bilah kemajuan di aplikasi). Aman dijalankan ulang. Butuh 0037.
alter table public.pdf_md_jobs
  add column if not exists progress integer not null default 0 check (progress between 0 and 100);
