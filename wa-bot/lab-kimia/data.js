// Data Laboratorium Kimia: 118 unsur (ID/EN) + daftar senyawa nyata yang aman dan edukatif.
// Tidak ada pustaka luar. Dipakai oleh core.js, render.js, ui.js dan tes.

// z|simbol|nama ID|nama EN|massa atom  (tanda kurung = nomor massa isotop paling stabil)
const MENTAH = `1|H|Hidrogen|Hydrogen|1.008
2|He|Helium|Helium|4.0026
3|Li|Litium|Lithium|6.94
4|Be|Berilium|Beryllium|9.0122
5|B|Boron|Boron|10.81
6|C|Karbon|Carbon|12.011
7|N|Nitrogen|Nitrogen|14.007
8|O|Oksigen|Oxygen|15.999
9|F|Fluor|Fluorine|18.998
10|Ne|Neon|Neon|20.180
11|Na|Natrium|Sodium|22.990
12|Mg|Magnesium|Magnesium|24.305
13|Al|Aluminium|Aluminium|26.982
14|Si|Silikon|Silicon|28.085
15|P|Fosfor|Phosphorus|30.974
16|S|Belerang|Sulfur|32.06
17|Cl|Klor|Chlorine|35.45
18|Ar|Argon|Argon|39.948
19|K|Kalium|Potassium|39.098
20|Ca|Kalsium|Calcium|40.078
21|Sc|Skandium|Scandium|44.956
22|Ti|Titanium|Titanium|47.867
23|V|Vanadium|Vanadium|50.942
24|Cr|Kromium|Chromium|51.996
25|Mn|Mangan|Manganese|54.938
26|Fe|Besi|Iron|55.845
27|Co|Kobalt|Cobalt|58.933
28|Ni|Nikel|Nickel|58.693
29|Cu|Tembaga|Copper|63.546
30|Zn|Seng|Zinc|65.38
31|Ga|Galium|Gallium|69.723
32|Ge|Germanium|Germanium|72.630
33|As|Arsen|Arsenic|74.922
34|Se|Selenium|Selenium|78.971
35|Br|Brom|Bromine|79.904
36|Kr|Kripton|Krypton|83.798
37|Rb|Rubidium|Rubidium|85.468
38|Sr|Stronsium|Strontium|87.62
39|Y|Itrium|Yttrium|88.906
40|Zr|Zirkonium|Zirconium|91.224
41|Nb|Niobium|Niobium|92.906
42|Mo|Molibdenum|Molybdenum|95.95
43|Tc|Teknesium|Technetium|(98)
44|Ru|Rutenium|Ruthenium|101.07
45|Rh|Rodium|Rhodium|102.91
46|Pd|Paladium|Palladium|106.42
47|Ag|Perak|Silver|107.87
48|Cd|Kadmium|Cadmium|112.41
49|In|Indium|Indium|114.82
50|Sn|Timah|Tin|118.71
51|Sb|Antimon|Antimony|121.76
52|Te|Telurium|Tellurium|127.60
53|I|Iodin|Iodine|126.90
54|Xe|Xenon|Xenon|131.29
55|Cs|Sesium|Caesium|132.91
56|Ba|Barium|Barium|137.33
57|La|Lantanum|Lanthanum|138.91
58|Ce|Serium|Cerium|140.12
59|Pr|Praseodimium|Praseodymium|140.91
60|Nd|Neodimium|Neodymium|144.24
61|Pm|Prometium|Promethium|(145)
62|Sm|Samarium|Samarium|150.36
63|Eu|Europium|Europium|151.96
64|Gd|Gadolinium|Gadolinium|157.25
65|Tb|Terbium|Terbium|158.93
66|Dy|Disprosium|Dysprosium|162.50
67|Ho|Holmium|Holmium|164.93
68|Er|Erbium|Erbium|167.26
69|Tm|Tulium|Thulium|168.93
70|Yb|Iterbium|Ytterbium|173.05
71|Lu|Lutetium|Lutetium|174.97
72|Hf|Hafnium|Hafnium|178.49
73|Ta|Tantalum|Tantalum|180.95
74|W|Wolfram|Tungsten|183.84
75|Re|Renium|Rhenium|186.21
76|Os|Osmium|Osmium|190.23
77|Ir|Iridium|Iridium|192.22
78|Pt|Platina|Platinum|195.08
79|Au|Emas|Gold|196.97
80|Hg|Raksa|Mercury|200.59
81|Tl|Talium|Thallium|204.38
82|Pb|Timbal|Lead|207.2
83|Bi|Bismut|Bismuth|208.98
84|Po|Polonium|Polonium|(209)
85|At|Astatin|Astatine|(210)
86|Rn|Radon|Radon|(222)
87|Fr|Fransium|Francium|(223)
88|Ra|Radium|Radium|(226)
89|Ac|Aktinium|Actinium|(227)
90|Th|Torium|Thorium|232.04
91|Pa|Protaktinium|Protactinium|231.04
92|U|Uranium|Uranium|238.03
93|Np|Neptunium|Neptunium|(237)
94|Pu|Plutonium|Plutonium|(244)
95|Am|Amerisium|Americium|(243)
96|Cm|Kurium|Curium|(247)
97|Bk|Berkelium|Berkelium|(247)
98|Cf|Kalifornium|Californium|(251)
99|Es|Einsteinium|Einsteinium|(252)
100|Fm|Fermium|Fermium|(257)
101|Md|Mendelevium|Mendelevium|(258)
102|No|Nobelium|Nobelium|(259)
103|Lr|Lawrensium|Lawrencium|(266)
104|Rf|Rutherfordium|Rutherfordium|(267)
105|Db|Dubnium|Dubnium|(268)
106|Sg|Seaborgium|Seaborgium|(269)
107|Bh|Bohrium|Bohrium|(270)
108|Hs|Hasium|Hassium|(277)
109|Mt|Meitnerium|Meitnerium|(278)
110|Ds|Darmstadtium|Darmstadtium|(281)
111|Rg|Roentgenium|Roentgenium|(282)
112|Cn|Kopernisium|Copernicium|(285)
113|Nh|Nihonium|Nihonium|(286)
114|Fl|Flerovium|Flerovium|(289)
115|Mc|Moskovium|Moscovium|(290)
116|Lv|Livermorium|Livermorium|(293)
117|Ts|Tenesin|Tennessine|(294)
118|Og|Oganeson|Oganesson|(294)`;

export const KATEGORI = {
  "logam-alkali": { warna: "#ff6b6b", nama: { id: "Logam alkali", en: "Alkali metal" } },
  "logam-alkali-tanah": { warna: "#ffa94d", nama: { id: "Logam alkali tanah", en: "Alkaline earth metal" } },
  "logam-transisi": { warna: "#ffd43b", nama: { id: "Logam transisi", en: "Transition metal" } },
  "logam-pasca-transisi": { warna: "#8ce99a", nama: { id: "Logam pasca-transisi", en: "Post-transition metal" } },
  "metaloid": { warna: "#38d9a9", nama: { id: "Metaloid", en: "Metalloid" } },
  "nonlogam": { warna: "#4dabf7", nama: { id: "Nonlogam", en: "Nonmetal" } },
  "halogen": { warna: "#9775fa", nama: { id: "Halogen", en: "Halogen" } },
  "gas-mulia": { warna: "#f783ac", nama: { id: "Gas mulia", en: "Noble gas" } },
  "lantanida": { warna: "#66d9e8", nama: { id: "Lantanida", en: "Lanthanide" } },
  "aktinida": { warna: "#da77f2", nama: { id: "Aktinida", en: "Actinide" } },
  "tak-diketahui": { warna: "#adb5bd", nama: { id: "Sifat belum diketahui", en: "Unknown properties" } },
};

const S = (...a) => new Set(a);
const NONLOGAM = S(1, 6, 7, 8, 15, 16, 34), MULIA = S(2, 10, 18, 36, 54, 86), HALOGEN = S(9, 17, 35, 53, 85);
const ALKALI = S(3, 11, 19, 37, 55, 87), TANAH = S(4, 12, 20, 38, 56, 88), METALOID = S(5, 14, 32, 33, 51, 52);
const PASCA = S(13, 31, 49, 50, 81, 82, 83, 84), GAS = S(1, 2, 7, 8, 9, 10, 17, 18, 36, 54, 86), CAIR = S(35, 80);

export function kategoriDari(z) {
  if (z >= 57 && z <= 71) return "lantanida";
  if (z >= 89 && z <= 103) return "aktinida";
  if (z >= 109) return "tak-diketahui";
  if (NONLOGAM.has(z)) return "nonlogam";
  if (MULIA.has(z)) return "gas-mulia";
  if (HALOGEN.has(z)) return "halogen";
  if (ALKALI.has(z)) return "logam-alkali";
  if (TANAH.has(z)) return "logam-alkali-tanah";
  if (METALOID.has(z)) return "metaloid";
  if (PASCA.has(z)) return "logam-pasca-transisi";
  return "logam-transisi";
}

/** Posisi di tabel 18 kolom. baris 1-7 = tabel utama, 9 = lantanida, 10 = aktinida (baris 8 = jarak). */
export function posisi(z) {
  if (z === 1) return { baris: 1, kolom: 1 };
  if (z === 2) return { baris: 1, kolom: 18 };
  if (z <= 4) return { baris: 2, kolom: z - 2 };
  if (z <= 10) return { baris: 2, kolom: z + 8 };
  if (z <= 12) return { baris: 3, kolom: z - 10 };
  if (z <= 18) return { baris: 3, kolom: z };
  if (z <= 36) return { baris: 4, kolom: z - 18 };
  if (z <= 54) return { baris: 5, kolom: z - 36 };
  if (z <= 56) return { baris: 6, kolom: z - 54 };
  if (z <= 71) return { baris: 9, kolom: z - 54 };
  if (z <= 86) return { baris: 6, kolom: z - 68 };
  if (z <= 88) return { baris: 7, kolom: z - 86 };
  if (z <= 103) return { baris: 10, kolom: z - 86 };
  return { baris: 7, kolom: z - 100 };
}

export const UNSUR = MENTAH.split("\n").map((baris) => {
  const [zs, simbol, id, en, ms] = baris.split("|");
  const z = Number(zs), tetap = ms.startsWith("(");
  const p = posisi(z);
  return {
    z, simbol, nama: { id, en },
    massa: Number(tetap ? ms.slice(1, -1) : ms), massaTetap: tetap,
    kategori: kategoriDari(z),
    baris: p.baris, kolom: p.kolom,
    periode: p.baris <= 7 ? p.baris : p.baris === 9 ? 6 : 7,
    golongan: p.baris <= 7 ? p.kolom : null,
    wujud: z >= 104 ? "tak-diketahui" : GAS.has(z) ? "gas" : CAIR.has(z) ? "cair" : "padat",
    radioaktif: z === 43 || z === 61 || z >= 84,
  };
});

export const PER_SIMBOL = new Map(UNSUR.map((u) => [u.simbol, u]));
export const PER_Z = new Map(UNSUR.map((u) => [u.z, u]));

// Senyawa nyata yang dikenal (hanya zat umum/edukatif; tidak ada resep, tidak ada bahan peledak atau senjata kimia).
// [rumus, nama ID, nama EN, wujud, warna, keterangan ID, keterangan EN, berbahaya]
export const SENYAWA = [
  ["H2O", "Air", "Water", "cair", "#6fc3ff", "Zat paling melimpah di permukaan Bumi; diminum dan dipakai setiap hari.", "The most abundant substance on Earth's surface; we drink and use it every day.", false],
  ["H2O2", "Hidrogen peroksida", "Hydrogen peroxide", "cair", "#cfe8ff", "Larutan yang sangat encer dipakai sebagai antiseptik; yang pekat berbahaya.", "Very dilute solutions are used as antiseptic; concentrated ones are dangerous.", true],
  ["CO2", "Karbon dioksida", "Carbon dioxide", "gas", "#dfe6ee", "Gas yang kita embuskan dan dipakai tumbuhan untuk fotosintesis.", "The gas we exhale and plants use for photosynthesis.", false],
  ["CO", "Karbon monoksida", "Carbon monoxide", "gas", "#d6dbe0", "Gas tak berbau hasil pembakaran tak sempurna; sangat beracun.", "An odorless gas from incomplete burning; very toxic.", true],
  ["CH4", "Metana", "Methane", "gas", "#e3e9ef", "Penyusun utama gas alam dan gas rawa.", "The main part of natural gas and marsh gas.", false],
  ["C3H8", "Propana", "Propane", "gas", "#e3e9ef", "Bahan bakar gas dalam tabung (elpiji).", "A fuel gas sold in cylinders (LPG).", false],
  ["C2H4", "Etena", "Ethene", "gas", "#e9f2e3", "Gas yang dihasilkan buah dan membantu pematangannya.", "A gas given off by fruit that helps it ripen.", false],
  ["C2H6O", "Etanol", "Ethanol", "cair", "#e7f3fb", "Alkohol untuk pelarut dan pembersih tangan.", "An alcohol used as solvent and hand sanitizer.", false],
  ["C2H4O2", "Asam asetat", "Acetic acid", "cair", "#f3ecd0", "Zat asam dalam cuka dapur yang encer.", "The sour part of diluted kitchen vinegar.", false],
  ["CH2O3", "Asam karbonat", "Carbonic acid", "cair", "#cfe3ff", "Terbentuk saat karbon dioksida larut di air; ada di minuman bersoda.", "Forms when carbon dioxide dissolves in water; found in fizzy drinks.", false],
  ["C6H12O6", "Glukosa", "Glucose", "padat", "#fff6e0", "Gula sederhana, sumber energi bagi tubuh.", "A simple sugar and an energy source for the body.", false],
  ["C12H22O11", "Sukrosa", "Sucrose", "padat", "#fffaf0", "Gula pasir yang kita pakai memaniskan makanan.", "Table sugar used to sweeten food.", false],
  ["NH3", "Amonia", "Ammonia", "gas", "#e2f0e8", "Gas berbau tajam untuk membuat pupuk; berbahaya bila dihirup banyak.", "A sharp-smelling gas used to make fertilizer; harmful in large amounts.", true],
  ["NaCl", "Natrium klorida", "Sodium chloride", "padat", "#fbfbfb", "Garam dapur.", "Table salt.", false],
  ["NaOH", "Natrium hidroksida", "Sodium hydroxide", "padat", "#f2f2f2", "Basa kuat (soda api) untuk industri sabun; sangat berbahaya bagi kulit.", "A strong base (caustic soda) used for soap; very harmful to skin.", true],
  ["HCl", "Asam klorida", "Hydrochloric acid", "cair", "#f3f7c8", "Asam kuat; dalam bentuk sangat encer ada di lambung.", "A strong acid; very dilute amounts are in the stomach.", true],
  ["H2SO4", "Asam sulfat", "Sulfuric acid", "cair", "#f1edc4", "Asam kuat yang dipakai pada aki mobil; berbahaya.", "A strong acid used in car batteries; dangerous.", true],
  ["HNO3", "Asam nitrat", "Nitric acid", "cair", "#f6efcc", "Asam kuat untuk industri pupuk; berbahaya.", "A strong acid for the fertilizer industry; dangerous.", true],
  ["H3PO4", "Asam fosfat", "Phosphoric acid", "cair", "#f5f1d9", "Asam untuk pupuk dan sedikit ada di minuman bersoda.", "An acid for fertilizer; a little is in fizzy drinks.", false],
  ["H2S", "Hidrogen sulfida", "Hydrogen sulfide", "gas", "#f0e7a8", "Gas berbau telur busuk; beracun.", "A rotten-egg-smelling gas; toxic.", true],
  ["SO2", "Belerang dioksida", "Sulfur dioxide", "gas", "#f2eebc", "Gas berbau tajam dari gunung berapi; berbahaya.", "A sharp gas from volcanoes; harmful.", true],
  ["CaCO3", "Kalsium karbonat", "Calcium carbonate", "padat", "#f4f1ea", "Penyusun batu kapur, kerang, dan kulit telur.", "Makes up limestone, seashells and eggshells.", false],
  ["CaO", "Kalsium oksida", "Calcium oxide", "padat", "#f1f1ec", "Kapur tohor untuk bahan bangunan.", "Quicklime used in building materials.", true],
  ["CaH2O2", "Kalsium hidroksida", "Calcium hydroxide", "padat", "#f6f4ee", "Kapur sirih; basa yang agak kuat.", "Slaked lime; a fairly strong base.", false],
  ["MgO", "Magnesium oksida", "Magnesium oxide", "padat", "#f7f7f5", "Serbuk putih tahan panas; bahan lapisan tungku.", "A heat-proof white powder; used to line furnaces.", false],
  ["Fe2O3", "Besi(III) oksida", "Iron(III) oxide", "padat", "#b5502a", "Karat berwarna cokelat kemerahan pada besi yang basah.", "The reddish-brown rust on wet iron.", false],
  ["Fe3O4", "Besi(II,III) oksida", "Iron(II,III) oxide", "padat", "#2b2b33", "Magnetit, mineral hitam yang ditarik magnet.", "Magnetite, a black mineral that sticks to magnets.", false],
  ["FeS2", "Besi disulfida", "Iron disulfide", "padat", "#d9b84a", "Pirit, 'emas bodoh' yang berkilau tapi bukan emas.", "Pyrite, 'fool's gold': shiny but not gold.", false],
  ["Al2O3", "Aluminium oksida", "Aluminium oxide", "padat", "#f5f5f5", "Bahan ampelas; permata rubi dan safir adalah bentuknya yang berwarna.", "Used for sandpaper; ruby and sapphire are coloured forms of it.", false],
  ["SiO2", "Silikon dioksida", "Silicon dioxide", "padat", "#efe6d2", "Pasir dan kuarsa; bahan utama kaca.", "Sand and quartz; the main ingredient of glass.", false],
  ["TiO2", "Titanium dioksida", "Titanium dioxide", "padat", "#fcfcfc", "Pigmen putih pada cat.", "The white pigment in paint.", false],
  ["CuO", "Tembaga(II) oksida", "Copper(II) oxide", "padat", "#2e2a28", "Serbuk hitam yang terbentuk saat tembaga dipanaskan di udara.", "A black powder made when copper is heated in air.", false],
  ["CuSO4", "Tembaga(II) sulfat", "Copper(II) sulfate", "padat", "#3b7fe0", "Terusi: hablur biru; jangan ditelan.", "Blue vitriol: bright blue crystals; do not swallow.", true],
  ["ZnO", "Seng oksida", "Zinc oxide", "padat", "#fbfbfb", "Serbuk putih untuk bedak dan tabir surya.", "A white powder used in powders and sunscreen.", false],
  ["AgCl", "Perak klorida", "Silver chloride", "padat", "#eeeeee", "Padatan putih yang menggelap bila kena cahaya; dulu dipakai pada film foto.", "A white solid that darkens in light; once used in photo film.", false],
  ["NaHCO3", "Natrium bikarbonat", "Sodium bicarbonate", "padat", "#fdfdfd", "Soda kue yang membuat adonan mengembang.", "Baking soda that makes dough rise.", false],
  ["Na2CO3", "Natrium karbonat", "Sodium carbonate", "padat", "#f9f9f9", "Soda abu untuk membuat kaca dan sabun.", "Soda ash used to make glass and soap.", false],
  ["KCl", "Kalium klorida", "Potassium chloride", "padat", "#f8f8f8", "Pupuk dan bahan garam pengganti.", "Fertilizer and an ingredient in salt substitutes.", false],
];

// Bentuk unsur bebas yang punya nama khusus: kunci "simbol+jumlah".
export const BENTUK_UNSUR = {
  H2: { id: "Gas hidrogen", en: "Hydrogen gas", wujud: "gas" },
  N2: { id: "Gas nitrogen", en: "Nitrogen gas", wujud: "gas" },
  O2: { id: "Gas oksigen", en: "Oxygen gas", wujud: "gas" },
  O3: { id: "Ozon", en: "Ozone", wujud: "gas" },
  F2: { id: "Gas fluor", en: "Fluorine gas", wujud: "gas" },
  Cl2: { id: "Gas klor", en: "Chlorine gas", wujud: "gas" },
  Br2: { id: "Cairan brom", en: "Liquid bromine", wujud: "cair" },
  I2: { id: "Iodin padat", en: "Solid iodine", wujud: "padat" },
  S8: { id: "Belerang", en: "Sulfur", wujud: "padat" },
  C60: { id: "Fulerena", en: "Fullerene", wujud: "padat" },
};
