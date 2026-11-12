import { runVariants } from "./lib.mjs";
const b = "ɪt wʌz dʒˈʌst maɪ kˈæt";
await runVariants("work/X", [["x0_plain", b + "."], ["x1_rise", b + "↗."], ["x2_fall", b + "↘."], ["x3_rise_word", "ɪt wʌz dʒˈʌst maɪ ↗kˈæt?"], ["x4_q", b + "?"], ["x5_level", b + "→."]].map(([name, phonemes]) => ({ name, phonemes })));
