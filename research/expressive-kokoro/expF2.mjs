import { runVariants, textToPhonemes } from "./lib.mjs";
const a = await textToPhonemes("Outside, the rain was falling gently on the streets of");
const b = await textToPhonemes(", while a French tourist struggled to pronounce");
const c = await textToPhonemes("Doctor");
const d = await textToPhonemes("received an unexpected phone call.");
const V = [
  ["cz0_en", `${a} zˈuːɹɪtʃ${b} ˈaɪkhɜːntʃən.`],
  ["cz1_de", `${a} ʦˈyːʁɪç${b} ˈaɪçhœʁnçən.`],
  ["cz2_de_soft", `${a} ʦˈyːɹɪç${b} ˈaɪçhœɹnçən.`],
  ["cm0_en", `${c} mˈuːlɚ ${d}`], ["cm1_y", `${c} mˈylɐ ${d}`], ["cm2_ʊ", `${c} mˈʊlɐ ${d}`], ["cm3_yː", `${c} mˈyːlɐ ${d}`],
];
await runVariants("work/F", V.map(([name, phonemes]) => ({ name, phonemes })));
