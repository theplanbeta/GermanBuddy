// Speech recognition per sentence of a scene render (whisper-base.en): every word there?
//   node asr_scene.cjs <name>   (reads <name>.wav and <name>.json with sentences, deliveries, starts)
const fs = require('fs');
const { asr, read, to16k, norm, wer } = require('./asr_clips.cjs');
const NUM = { ten: '10', twenty: '20' };
const words = (s) => norm(s.replace(/…/g, ' ').replace(/—/g, ' ')).map((w) => NUM[w] ?? w);
(async () => {
  const name = process.argv[2];
  const info = JSON.parse(fs.readFileSync(`${__dirname}/${name}.json`, 'utf8'));
  const all = read(`${__dirname}/${name}.wav`);
  const en = await asr();
  const rows = [];
  let errs = 0, total = 0;
  for (let i = 0; i < info.sentences.length; i++) {
    const s0 = all.slice(info.starts[i], info.starts[i + 1] ?? all.length); const a = new Float32Array(s0.length + 9600); a.set(s0, 4800); // 0.2 s of silence on each side
    const said = info.deliveries[i].parts.map((p) => p.text).join(' ');
    const heard = (await en(to16k(a))).text.trim();
    const ref = words(said), hyp = words(heard);
    const e = wer(ref, hyp);
    errs += e; total += ref.length;
    // first and last word present (nothing cut at a splice, pause or voice change)
    const edges = hyp[0] === ref[0] && hyp.at(-1) === ref.at(-1);
    rows.push({ i, said, heard, errors: e, edges });
    if (e || !edges) console.log(`${i}. said: ${said}\n    heard: ${heard}  (${e} word errors${edges ? '' : ', FIRST/LAST WORD DIFFERS'})`);
  }
  console.log(`${name}: ${total} words, ${errs} word errors (${(100 * errs / total).toFixed(1)}%), sentences with first+last word right: ${rows.filter((r) => r.edges).length}/${rows.length}`);
  fs.writeFileSync(`${__dirname}/${name}.asr.json`, JSON.stringify(rows, null, 1));
})();
