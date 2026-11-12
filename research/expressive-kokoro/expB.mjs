import { runVariants } from "./lib.mjs";
const W = [
  ["b01_orig_quotes", "“Wait… WHAT?!”"], ["b02_noquotes", "Wait… WHAT?!"], ["b03_dots3", "Wait... what?!"],
  ["b04_comma", "Wait, what?!"], ["b05_dash", "Wait — what?!"], ["b06_excl_excl", "Wait! What?!"],
  ["b07_q_only", "Wait… what?"], ["b08_excl_only", "Wait… what!"], ["b09_qq", "Wait… what?!?!"],
  ["b10_period", "Wait. What?!"], ["b11_double_ell", "Wait…… what?!"], ["b12_lower", "wait… what?!"],
];
await runVariants("work/B", W.map(([name, text]) => ({ name, text })));
// commas / ellipsis as pause makers inside a sentence
const P = [
  ["p1_plain", "You're telling me the budget has simply disappeared?"],
  ["p2_ellipsis", "You're telling me the budget has simply… disappeared?"],
  ["p3_dots", "You're telling me the budget has simply... disappeared?"],
  ["p4_comma", "You're telling me the budget has simply, disappeared?"],
  ["p5_dash", "You're telling me the budget has simply — disappeared?"],
  ["p6_dashnospace", "You're telling me the budget has simply—disappeared?"],
  ["p7_period", "You're telling me the budget has simply. Disappeared?"],
  ["p8_two_ell", "You're telling me the budget has simply… … disappeared?"],
  ["p9_semicolon", "You're telling me the budget has simply; disappeared?"],
  ["p10_colon", "You're telling me the budget has simply: disappeared?"],
];
await runVariants("work/B", P.map(([name, text]) => ({ name, text })));
// end punctuation -> contour
const E = [["e1_period", "It was just my cat."], ["e2_excl", "It was just my cat!"], ["e3_q", "It was just my cat?"], ["e4_qexcl", "It was just my cat?!"], ["e5_ell", "It was just my cat…"], ["e6_none", "It was just my cat"], ["e7_triple_excl", "It was just my cat!!!"]];
await runVariants("work/B", E.map(([name, text]) => ({ name, text })));
// caps
const C = [["c1_lower", "I said stop right now."], ["c2_caps_word", "I said STOP right now."], ["c3_caps_all", "I SAID STOP RIGHT NOW."], ["c4_caps_excl", "I said STOP right now!"]];
await runVariants("work/B", C.map(([name, text]) => ({ name, text })));
