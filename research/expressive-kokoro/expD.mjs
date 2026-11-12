import { runVariants, textToPhonemes, toMisaki } from "./lib.mjs";
const V = [
  ["s0_base", "aɪ sˈɛd stˈɑːp ɹˈaɪt nˈaʊ."],
  ["s1_only_stop_stressed", "aɪ sɛd stˈɑːp ɹaɪt naʊ."],
  ["s2_others_secondary", "aɪ sˌɛd stˈɑːp ɹˌaɪt nˌaʊ."],
  ["s3_lengthen", "aɪ sˈɛd stˈɑːːp ɹˈaɪt nˈaʊ."],
  ["s4_comma_before", "aɪ sˈɛd, stˈɑːp ɹˈaɪt nˈaʊ."],
  ["s5_comma_around", "aɪ sˈɛd, stˈɑːp, ɹˈaɪt nˈaʊ."],
  ["s6_combo", "aɪ sɛd, stˈɑːːp, ɹaɪt naʊ."],
  ["s7_double_mark", "aɪ sˈɛd stˈˈɑːp ɹˈaɪt nˈaʊ."],
  ["s8_excl_after", "aɪ sˈɛd stˈɑːp! ɹˈaɪt nˈaʊ."],
  ["w0_base", "wˈeɪt… wˈʌt?!"],
  ["w1_demote_wait", "wˌeɪt… wˈʌt?!"],
  ["w2_lengthen_what", "wˈeɪt… wˈʌːt?!"],
  ["w3_dots_lengthen", "wˈeɪt... wˈʌːt?!"],
  ["w4_combo", "wˌeɪt... wˈʌːːt?!"],
  ["w5_excl_split", "wˈeɪt... wˈʌt?! wˈʌt?!"],
];
await runVariants("work/D", V.map(([name, phonemes]) => ({ name, phonemes })));
