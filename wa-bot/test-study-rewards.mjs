// Tes aturan hadiah per orang tua (study-core.ts) + penjaga di server.  node test-study-rewards.mjs
import fs from "node:fs";
import { rewardManageableBy, rewardVisibleToPlayer } from "../supabase/functions/_shared/study-core.ts";

let gagal = 0;
const check = (c, n) => { console.log(`${c ? "ok" : "GAGAL"}: ${n}`); if (!c) gagal++; };
check(rewardVisibleToPlayer(null, []) && rewardVisibleToPlayer(undefined, ["a"]), "hadiah bersama terlihat semua anak");
check(rewardVisibleToPlayer("a", ["a"]) && rewardVisibleToPlayer("b", ["a", "b"]), "anak melihat hadiah orang tuanya (gabungan bila dua orang tua)");
check(!rewardVisibleToPlayer("b", ["a"]) && !rewardVisibleToPlayer("a", []), "anak tidak melihat hadiah orang tua yang tak tertaut");
check(rewardManageableBy(null, "a") && rewardManageableBy("a", "a"), "bersama: siapa pun; milik sendiri: boleh");
check(!rewardManageableBy("b", "a"), "hadiah orang tua lain tak bisa diubah/dihapus");

const src = fs.readFileSync(new URL("../supabase/functions/study/index.ts", import.meta.url), "utf8");
const blk = (name) => { const i = src.indexOf(`if (action === "${name}")`); return src.slice(i, i + 2500); };
check(/loadItemsForPlayer\(admin, auth\.player\.id as string\);[\s\S]{0,200}allowed\.some/.test(blk("redeem")), "redeem: dicek di server bahwa hadiah boleh untuk anak itu");
check(/rewardManageableBy/.test(blk("redeem_item_save")) && /rewardManageableBy/.test(blk("redeem_item_delete")), "ubah/hapus: hanya pemilik (atau hadiah bersama)");
check(/owner_parent_id = par\.parent\.id/.test(blk("redeem_item_save")), "hadiah baru dimiliki orang tua yang menambah");
check(/loadItemsForParent/.test(blk("settings_open")) && /loadItemsForPlayer/.test(blk("player_profile")), "Settings: hadiah sendiri+bersama; profil anak: hadiah orang tuanya+bersama");
check(/q\("id,name,cost"\)/.test(src) && /hasOwner/.test(src), "tetap jalan sebelum migrasi 0045 (fallback tanpa kolom pemilik)");
const mig = fs.readFileSync(new URL("../supabase/migrations/0045_study_parent_rewards.sql", import.meta.url), "utf8");
check(/add column if not exists owner_parent_id/.test(mig) && !/delete from|\bdrop\b|\bupdate\b|\btruncate\b/i.test(mig.replace(/--.*$/gm, "")), "migrasi hanya menambah kolom (tidak mengubah/menghapus data)");
const ui = fs.readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8");
check((ui.match(/study_reward_shared:/g) || []).length === 2 && (ui.match(/study_reward_help:/g) || []).length === 2, "teks ID/EN lengkap");
process.exit(gagal ? 1 : 0);
