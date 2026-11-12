import { runVariants, textToPhonemes } from "./lib.mjs";
const en = async (t) => await textToPhonemes(t);
const V = [
  ["g0_english_rules", await en("Das kann doch nicht wahr sein.")],
  ["g1_espeak_de_mapped", "das kˌan dɔχ nˈɪçt vˈɑːɾ zaɪn."],
  ["g2_de_anglicised", "dˈas kˌan dˈɔk nˈɪʃt vˈɑː zˈaɪn."],
  ["g3_de_misaki", "das kˌan dɔχ nˈɪçt vˈɑːɾ zIn."],
  ["g4_de_uvular_r", "das kˌan dɔχ nˈɪçt vˈɑːʁ zaɪn."],
  ["z0_zurich_en", await en("Zürich.")], ["z1_zurich_de", "ʦˈyːʁɪç."], ["z2_zurich_de_k", "ʦˈyːɹɪk."],
  ["m0_muller_en", await en("Müller.")], ["m1_muller_de_y", "mˈylɐ."], ["m2_muller_de_u", "mˈʊlɐ."], ["m3_muller_de_i", "mˈɪlɐ."],
  ["e0_eich_en", await en("Eichhörnchen.")], ["e1_eich_de", "ˈaɪçhœɾnçən."], ["e2_eich_de_misaki", "ˈIçhœʁnçən."],
  ["a0_achtung_en", await en("Achtung!")], ["a1_achtung_de", "ˈaχtʊŋ!"],
  ["k0_cuidado_en", await en("¡Cuidado!")], ["k1_cuidado_es", "¡kwiðˈaðo!"], ["k2_cuidado_es_noexcl", "kwiðˈaðo!"],
];
await runVariants("work/F", V.map(([name, phonemes]) => ({ name, phonemes })));
await runVariants("work/F", [{ name: "k3_cuidado_es_dora", phonemes: "¡kwiðˈaðo!", style: "ef_dora" }, { name: "g5_de_mapped_timbre_heart_pros_dora", phonemes: "das kˌan dɔχ nˈɪçt vˈɑːɾ zaɪn.", style: { timbre: "af_heart", prosody: "ef_dora" } }]);
