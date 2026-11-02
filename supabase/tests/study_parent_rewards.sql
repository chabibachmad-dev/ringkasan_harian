-- Uji skema hadiah per orang tua (0045). Jalankan di DATABASE KOSONG/uji, bukan produksi (membuat dan menghapus data uji).
-- Hasil akhir: gagal = 0.
create temp table res(name text, ok boolean);
create or replace function pg_temp.chk(n text, c boolean) returns void language sql as $$ insert into res values (n, coalesce(c,false)) $$;
do $$
declare pa uuid; pb uuid; i1 uuid; i2 uuid; ok boolean;
begin
  insert into study_parents(name,pin_salt,pin_hash) values ('RwIbu','s','h') returning id into pa;
  insert into study_parents(name,pin_salt,pin_hash) values ('RwBapak','s','h') returning id into pb;
  insert into study_redeem_items(name,cost,sort) values ('RwBersama',10,901);
  perform pg_temp.chk('hadiah lama/bersama: owner null', (select owner_parent_id is null from study_redeem_items where name='RwBersama'));
  insert into study_redeem_items(name,cost,sort,owner_parent_id) values ('RwMilikIbu',20,902,pa) returning id into i1;
  insert into study_redeem_items(name,cost,sort,owner_parent_id) values ('RwMilikBapak',30,903,pb) returning id into i2;
  perform pg_temp.chk('hadiah punya pemilik', (select owner_parent_id from study_redeem_items where id=i1) = pa);
  begin insert into study_redeem_items(name,cost,sort,owner_parent_id) values ('x',1,904,gen_random_uuid()); ok := false; exception when foreign_key_violation then ok := true; end;
  perform pg_temp.chk('pemilik harus orang tua yang ada', ok);
  delete from study_parents where id = pa;
  perform pg_temp.chk('hapus orang tua: hadiahnya jadi bersama (tidak hilang)', exists (select 1 from study_redeem_items where id=i1 and owner_parent_id is null));
  delete from study_redeem_items where name like 'Rw%';
  delete from study_parents where name like 'Rw%';
end $$;
select name, ok from res order by ok, name;
select count(*) filter (where not ok) as gagal from res;
