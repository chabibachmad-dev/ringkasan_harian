// Pagar keamanan: pembatasan folder, penolakan perintah berbahaya, anti-SSRF untuk pengambilan web.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import dns from "node:dns/promises";
import os from "node:os";

const win = () => process.platform === "win32";
const norm = (p) => (win() ? p.toLowerCase() : p);

/** "~" dan "~/abc" -> folder rumah akun yang menjalankan agent. */
export function expandHome(p, home = os.homedir()) {
  const s = String(p ?? "");
  if (s === "~") return home;
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.join(home, s.slice(2));
  return s;
}

export class SafetyError extends Error {}

/** Apakah `target` berada di dalam `root` (atau sama)? Perbandingan tidak peka huruf besar di Windows. */
export function isInside(root, target) {
  const r = norm(path.resolve(root));
  const t = norm(path.resolve(target));
  return t === r || t.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** realpath dari bagian yang sudah ada (supaya symlink/junction tidak bisa dipakai keluar folder). */
function realOfExisting(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Berkas/folder rahasia yang tidak boleh disentuh alat berkas walau ada di dalam folder izin (kunci, token, sesi login). */
const SECRET_NAME = /^(?:\.env(?!\.example$).*|auth_session|\.ssh|\.gnupg|\.aws|\.netrc|\.git-credentials|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|credentials\.json|.*\.(?:pem|key|p12|pfx|kdbx))$/i;
export const isSecretPath = (p) => path.resolve(String(p)).split(/[\\/]+/).some((seg) => SECRET_NAME.test(seg));

/**
 * Alamat dari model -> alamat absolut yang DIJAMIN di dalam salah satu folder izin.
 * Alamat relatif dianggap relatif terhadap workdir. Melempar SafetyError bila keluar dari folder izin.
 */
export function resolveInRoots(input, { roots, workdir }) {
  const raw = expandHome(String(input ?? "").trim().replace(/^["']|["']$/g, ""));
  if (!raw) throw new SafetyError("Alamat kosong.");
  if (raw.includes("\0")) throw new SafetyError("Alamat tidak valid.");
  if (!roots.length) throw new SafetyError("Belum ada folder yang diizinkan (AGENT_ROOTS kosong).");
  let abs;
  if (path.isAbsolute(raw)) abs = path.resolve(raw);
  else {
    // Alamat relatif: utamakan folder kerja; bila tidak ada di sana tetapi ada di salah satu folder izin lain, pakai itu
    // (model kecil sering hanya menyebut nama berkas). Berkas baru (belum ada di mana pun) dibuat di folder kerja.
    const cands = [...new Set([workdir || roots[0], ...roots].map((b) => path.resolve(b, raw)))];
    abs = cands.find((c) => fs.existsSync(c)) || cands[0];
  }
  const real = realOfExisting(abs);
  const okRoot = roots.find((r) => isInside(realOfExisting(r), real) && isInside(r, abs));
  if (!okRoot) throw new SafetyError(`Ditolak: ${abs} berada di luar folder yang diizinkan.`);
  if (isSecretPath(real)) throw new SafetyError(`Ditolak: ${path.basename(abs)} termasuk berkas rahasia (kunci/token/sesi).`);
  return abs;
}

// Perintah yang TIDAK PERNAH dijalankan walau pemilik menekan Ya (terlalu mudah merusak laptop).
const HARD_BLOCK = [
  /\bformat(?:-volume)?\b\s*(?:[a-z]:|-driveletter)/i,
  /\bdiskpart\b/i,
  /\bclear-disk\b|\bremove-partition\b|\binitialize-disk\b/i,
  /\bbcdedit\b|\bbootrec\b/i,
  /\breg(?:\.exe)?\s+(?:delete|add|import)\b/i,
  /\b(?:remove|set|new)-itemproperty\b.*\bhk(?:lm|cu|ey_)/i,
  /\bnet\s+user\b|\bnet\s+localgroup\b|\bnew-localuser\b/i,
  /\bset-executionpolicy\b/i,
  /\b(?:rm|del|erase|rd|rmdir|remove-item)\b[^|;&\n]*(?:^|\s)(?:[a-z]:\\?(?:\s|$|\*)|\\\s*$|\/\s*$|~\s*$)/i,
  /\b(?:rm|remove-item)\b[^|;\n]*-(?:r|recurse)\b[^|;\n]*\b(?:c:\\windows|c:\\users\s|c:\\program)/i,
  /\bvssadmin\b.*\bdelete\b|\bwevtutil\b.*\bcl\b/i,
  /\b(?:invoke-expression|iex)\b.*\b(?:downloadstring|invoke-webrequest|iwr|curl|wget)\b/i,
  /\b(?:downloadstring|downloadfile)\b/i,
  /\bstart-process\b[^|;\n]*-verb\s+runas\b/i,
  /\bschtasks\b.*\/create\b|\bregister-scheduledtask\b/i,
  /\bshutdown(?:\.exe)?\b|\brestart-computer\b|\bstop-computer\b/i,
  /-encodedcommand\b|\s-enc\s/i
];

// Khusus Linux (server Ubuntu): dipakai di semua sistem; aturan Windows di atas tidak mengganggu perintah Linux.
const SYS_DIRS = "etc|usr|var|boot|bin|sbin|lib|lib32|lib64|home|root|opt|srv|sys|proc|dev|mnt|media|snap";
const HARD_BLOCK_LINUX = [
  // naik hak akses / ganti identitas
  /(?:^|[\s;&|(`])(?:sudo|doas|pkexec)(?:\s|$)/i,
  /(?:^|[;&|(`]\s*)su(?:\s+-\S*)?(?:\s+\S+)?\s*(?:$|[;&|])/i,
  // hapus massal di akar / rumah / folder sistem
  /--no-preserve-root/i,
  new RegExp(String.raw`\brm\b[^|;&\n]*\s-[a-z]*r[a-z]*\b[^|;&\n]*\s(?:\/|\/\*|\/(?:${SYS_DIRS})(?:\/\*?)?|~\/?\*?|\$\{?HOME\}?\/?\*?)(?=\s|$|[;&|])`, "i"),
  new RegExp(String.raw`\brm\b[^|;&\n]*\s--recursive\b[^|;&\n]*\s(?:\/|\/\*|\/(?:${SYS_DIRS})(?:\/\*?)?|~\/?\*?|\$\{?HOME\}?\/?\*?)(?=\s|$|[;&|])`, "i"),
  /\bfind\s+(?:\/|~|\$HOME)(?:\s|\/\s)[^|;\n]*-delete\b/i,
  // disk
  /\bmkfs(?:\.\w+)?\b|\bwipefs\b|\bfdisk\b|\bsfdisk\b|\bparted\b|\bcryptsetup\b|\bmkswap\b/i,
  /\bdd\b[^|;&\n]*\bof=\/dev\//i,
  />\s*\/dev\/(?:sd|nvme|vd|hd|mmcblk)/i,
  /\bshred\b[^|;&\n]*\/dev\//i,
  /\bch(?:mod|own)\b[^|;&\n]*\s-[a-z]*R[a-z]*\b[^|;&\n]*\s\/(?:\s|$|\*)/,
  // matikan / mulai ulang mesin
  /\b(?:poweroff|reboot|halt)\b|\binit\s+[06]\b|\btelinit\s+[06]\b/i,
  /\bsystemctl\b[^|;&\n]*\b(?:poweroff|reboot|halt|suspend|hibernate|hybrid-sleep|kexec|rescue|emergency)\b/i,
  // jangan putus jalur akses jarak jauh milik pemilik
  /\bsystemctl\b[^|;&\n]*\b(?:stop|disable|mask|kill)\b[^|;&\n]*\b(?:ssh|sshd|tailscaled?|networking|networkmanager|systemd-networkd|ufw)\b/i,
  /\b(?:service)\s+(?:ssh|sshd|tailscaled|networking|network-manager|ufw)\s+stop\b/i,
  /\bufw\b[^|;&\n]*\b(?:disable|reset)\b/i,
  /\bufw\s+(?:delete|deny|reject)\b[^|;&\n]*\b(?:22|ssh|openssh)\b/i,
  /\b(?:iptables|ip6tables|nft)\b[^|;&\n]*(?:\s-F\b|\s--flush\b|\sflush\b)/i,
  /\btailscale\s+(?:down|logout|set\b[^|;&\n]*--ssh=false)/i,
  /\bauthorized_keys\b|\bsshd?_config\b/i,
  // akun & hak akses
  /\b(?:passwd|chpasswd|useradd|userdel|usermod|adduser|deluser|groupadd|groupdel|visudo|gpasswd)\b/i,
  /\/etc\/(?:passwd|shadow|gshadow|sudoers)/i,
  /(?:>>?|\btee\b(?:\s+-a)?|\bsed\s+-i\S*|\bmv\b|\bcp\b|\bln\b)[^|;&\n]*\s\/etc\//i,
  // unduh-lalu-jalankan
  /\|\s*(?:sudo\s+)?(?:ba|z|da|k|c|tc|a)?sh\b(?=\s|$|;|&|\))/i,
  /\b(?:ba|z|da)?sh\s+<\(\s*(?:curl|wget)\b/i,
  /\beval\b[^|;\n]*\$\(\s*(?:curl|wget)\b/i,
  /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby|php)\b/i,
  /\bbase64\s+(?:-d|--decode)\b[^\n]*\|/i,
  // penjadwalan & layanan baru, bom fork
  /\bcrontab\b|\bsystemd-run\b/i,
  /\bsystemctl\b[^|;&\n]*\b(?:enable|link|edit|daemon-reload)\b/i,
  /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/,
  // berkas rahasia (token, kunci SSH, sesi login WhatsApp) tidak boleh dibaca/dikirim lewat shell
  /(?:^|[\s/='"<>@])\.env(?![\w.-])|\.env\.(?!example\b)\w+|\bauth_session\b|\.ssh\/|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|\.pem\b|\.gnupg\b|\.git-credentials|\.netrc\b|\.aws\/credentials/i,
  // alat serangan / pemantau jaringan
  /\b(?:nmap|masscan|hydra|hashcat|tcpdump|ettercap|aircrack-ng|ncat|netcat)\b/i
];

/** -> alasan penolakan atau null bila boleh DIAJUKAN (tetap perlu persetujuan pemilik). */
export function commandProblem(cmd) {
  const c = String(cmd ?? "");
  if (!c.trim()) return "Perintah kosong.";
  if (c.length > 2000) return "Perintah terlalu panjang (maks 2000 huruf).";
  if (HARD_BLOCK.some((re) => re.test(c)) || HARD_BLOCK_LINUX.some((re) => re.test(c))) return "Perintah ini ditolak permanen karena terlalu berbahaya (sudo/akun, format disk, hapus massal, matikan mesin, putus SSH/jaringan, berkas rahasia, unduh-lalu-jalankan, dll).";
  return null;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
/** IP pribadi/loopback/link-local? (dicegah supaya agent tidak bisa dipakai membuka layanan lokal/router) */
export function isPrivateIp(ip) {
  const s = String(ip ?? "").toLowerCase();
  if (net.isIPv4(s)) return PRIVATE_V4.some((re) => re.test(s));
  if (net.isIPv6(s)) {
    if (s === "::1" || s === "::") return true;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    return m ? isPrivateIp(m[1]) : false;
  }
  return true;
}

/** URL dari model -> URL aman (http/https, bukan alamat lokal). Melempar SafetyError. */
export async function checkPublicUrl(input, { lookup = dns.lookup } = {}) {
  let u;
  try {
    u = new URL(String(input ?? "").trim());
  } catch {
    throw new SafetyError("Alamat web tidak valid.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new SafetyError("Hanya alamat http/https yang boleh dibuka.");
  if (u.username || u.password) throw new SafetyError("Alamat dengan kata sandi tidak diizinkan.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$|\.lan$/i.test(host)) throw new SafetyError("Alamat lokal tidak boleh dibuka.");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SafetyError("Alamat jaringan lokal tidak boleh dibuka.");
    return u;
  }
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new SafetyError("Alamat itu mengarah ke jaringan lokal; tidak boleh dibuka.");
  return u;
}
