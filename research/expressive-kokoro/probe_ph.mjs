import { phonemize, list_voices } from "phonemizer";
const v = await list_voices();
console.log(v.length, v.map(x=>x.languages.map(l=>l.name).join('/')).join(', '));
for (const [t,l] of [["Das kann doch nicht wahr sein.","de"],["Eichhörnchen","de"],["Zürich","de"],["Müller","de"],["¡Cuidado!","es"],["Achtung!","de"],["Das kann doch nicht wahr sein.","en-us"],["Eichhörnchen Zürich Müller","en-us"],["Wait… WHAT?!","en-us"],["Wait... what?!","en-us"],["7:43 a.m. 37.8% €2.45 million 62-year-old 1,250 0.75 15%","en-us"]]) console.log(l, t, "=>", JSON.stringify(await phonemize(t,l)));
