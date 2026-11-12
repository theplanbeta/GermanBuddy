import { foreignPhrase, detectLanguage } from "./foreign.mjs";
const de = ["Das kann doch nicht wahr sein.", "Ich habe keine Zeit.", "Wo ist der Bahnhof?", "Guten Morgen, wie geht es dir?", "Das Wetter ist heute schön.", "Wir fahren morgen nach Berlin.", "Entschuldigung, sprechen Sie Englisch?", "Achtung!"];
for (const t of de) console.log(detectLanguage(t), t, "=>", foreignPhrase(t, "de"));
for (const t of ["¡Cuidado!", "¿Dónde está la biblioteca?", "Muchas gracias, señor."]) console.log(detectLanguage(t), t, "=>", foreignPhrase(t, "es"));
for (const t of ["Watch out!", "Relax, everyone!", "Wait… WHAT?!"]) console.log(detectLanguage(t), t);
