// Hand-made region specs (top-left PDF points) for real documents. Regions are listed in reading order;
// skip-type regions (captions, figure text, running heads) are listed last on a page so that
// cross-column continuation (`cont`) links paragraph regions directly.
const R = new URL('../../corpus/real/', import.meta.url).pathname;
export const specs = [
  {
    id: 'real-tracemonkey', file: R + 'tracemonkey.pdf', kind: 'paper-2col (LaTeX, ACM)', title: 'Trace-based JIT (PLDI 2009)', source: 'pdf.js test corpus (mozilla/pdf.js test/pdfs/tracemonkey.pdf)',
    keepHyphen: ['dynamically-typed', 'type-specialized', 'mixed-mode', 'method-based', 'trace-based', 'non-experts', 'client-side', 'type-stable', 'just-in-time', 'run-time', 'inter-procedural', 'byte-code', 'trace-compilation'],
    fix: [['ﬁ', 'fi'], ['ﬂ', 'fl'], ['a na¨ ıve', 'a naïve'], ['na¨ıve', 'naïve'], ['Trace- Monkey', 'TraceMonkey']],
    pages: {
      1: [
        ['heading', [60, 75, 560, 115], { level: 1 }],
        ['neutral', [40, 125, 580, 285]],
        ['heading', [50, 333, 100, 347], { level: 2 }],
        ['paragraph', [50, 348, 300, 492]],
        ['paragraph', [50, 495, 300, 560], { split: 'gap' }],
        ['heading', [50, 566, 150, 580], { level: 2 }],
        ['paragraph', [50, 582, 300, 640]],
        ['paragraph', [310, 335, 560, 730], { cont: true }],
        ['other', [50, 665, 300, 730]],
      ],
      2: [
        ['paragraph', [50, 60, 300, 530], { cont: true }],
        ['list-item', [55, 531, 310, 618], { split: 'marker' }],
        ['paragraph', [50, 619, 300, 730]],
        ['paragraph', [310, 488, 560, 520], { cont: true }],
        ['heading', [310, 521, 560, 542], { level: 2 }],
        ['paragraph', [310, 543, 560, 730]],
        ['figure-text', [310, 60, 560, 132]],
        ['caption', [310, 133, 560, 172]],
        ['figure-text', [320, 195, 560, 372]],
        ['caption', [310, 380, 560, 482]],
      ],
    },
  },
  {
    id: 'real-freeculture', file: R + 'freeculture.pdf', kind: 'book (running heads, block quote, note markers)', title: 'Free Culture (Lessig), pp. 50–52', source: 'pdf.js test corpus (freeculture.pdf, CC BY-NC 1.0)',
    keepHyphen: ['read-only', 'Cinema-Television', 'twenty-first', 'non'],
    fix: [['generally, 10 it', 'generally, it'], ['“grammar” 10', '“grammar”'], ['to me, 11 the', 'to me, the'], ['texture.” 11 But', 'texture.” But'], ['explained to me, the grammar', 'explained to me, the grammar'], ['it. 12 ', 'it. '], [' 12 ', ' '], ['“empower 13', '“empower'], ['14 ', ''], ['13 It', 'It'], ['author. 12', 'author.']],
    pages: {
      50: [['paragraph', [40, 40, 352, 530]], ['header-footer', [40, 532, 135, 552]], ['other', [100, 565, 300, 590]]],
      51: [['paragraph', [50, 40, 352, 326], { cont: true }], ['paragraph', [60, 330, 340, 412], { split: 'none' }], ['paragraph', [50, 415, 352, 530]], ['header-footer', [280, 532, 352, 552]], ['other', [100, 565, 300, 590], { optional: true }]],
      52: [['paragraph', [40, 40, 352, 530], { cont: true }], ['header-footer', [40, 532, 135, 552]], ['other', [100, 565, 300, 590]]],
    },
  },
  {
    id: 'real-fedreg', file: R + 'federal-register-2020-17221.pdf', kind: 'government 3-column with footnotes', title: 'Federal Register 2020-17221 p.2', source: 'pdfplumber test corpus (US government work, public domain)',
    keepHyphen: ['nose-down', 'nose-up', 'AI–01', 'data-sharing', 'non-'],
    fix: [['’’', '”'], ['‘‘', '“'], ['trim 3 commands', 'trim commands'], ['alert, 5 and may', 'alert, and may'], ['action. 6 The FAA', 'action. The FAA'], ['reports 7 of', 'reports of'], ['(MCAS) 8 can', '(MCAS) can'], ['reports 1 from', 'reports from'], ['(AOA) sensor 4 input', '(AOA) sensor input'], ['system 2 generated', 'system generated'], ['(3) revising certain AFM', '(3) revising certain AFM'], ['alert, 9 (3)', 'alert, (3)']],
    pages: {
      2: [
        ['paragraph', [40, 50, 217, 388]],
        ['paragraph', [218, 50, 395, 428], { cont: true }],
        ['paragraph', [396, 50, 572, 536], { cont: true }],
        ['footnote', [40, 389, 217, 745]],
        ['footnote', [218, 429, 395, 745]],
        ['footnote', [396, 537, 572, 745]],
        ['header-footer', [100, 22, 500, 46]],
        ['page-number', [520, 22, 575, 46]],
        ['other', [10, 758, 470, 780]],
      ],
    },
  },
  {
    id: 'real-scotus', file: R + 'scotus-transcript-p1.pdf', kind: 'legal transcript (line numbers)', title: 'SCOTUS transcript p.1', source: 'pdfplumber test corpus (US government work)',
    pages: {
      1: [
        ['heading', [140, 62, 450, 80], { level: 1 }],
        ['neutral', [120, 90, 480, 262]],
        ['paragraph', [280, 270, 480, 290]],
        ['paragraph', [280, 295, 480, 315]],
        ['paragraph', [120, 340, 535, 418], { split: 'none' }],
        ['heading', [120, 425, 220, 442], { level: 2 }],
        ['paragraph', [120, 450, 510, 492], { split: 'none' }],
        ['paragraph', [120, 502, 510, 545], { split: 'none' }],
        ['page-number', [80, 50, 112, 700]],
        ['header-footer', [200, 30, 450, 50]],
        ['page-number', [300, 715, 340, 740]],
        ['header-footer', [240, 742, 400, 760]],
      ],
    },
  },
  {
    id: 'real-pv-fr', file: R + '2023-06-20-PV.pdf', kind: 'municipal minutes (Word, French)', title: 'Procès-verbal Sainte-Adèle', source: 'pdfplumber test corpus (public municipal record)',
    pages: {
      1: [
        ['heading', [220, 118, 392, 140], { level: 1 }],
        ['heading', [250, 145, 360, 168], { level: 1 }],
        ['heading', [120, 169, 495, 184], { level: 2 }],
        ['heading', [65, 190, 140, 212], { level: 2 }],
        ['paragraph', [65, 213, 330, 260], { split: 'line' }],
        ['paragraph', [65, 265, 390, 300], { split: 'line' }],
        ['heading', [65, 318, 220, 340], { level: 2 }], ['paragraph', [65, 344, 300, 366]],
        ['heading', [65, 385, 240, 406], { level: 2 }], ['paragraph', [65, 410, 300, 432]],
        ['heading', [65, 450, 260, 472], { level: 2 }], ['paragraph', [65, 476, 300, 498]],
        ['heading', [65, 516, 460, 538], { level: 2 }],
        ['heading', [230, 543, 380, 566], { level: 3 }],
        ['paragraph', [95, 570, 500, 915], { split: 'gap' }],
      ],
      2: [
        ['paragraph', [95, 62, 500, 112], { split: 'gap', cont: false }],
        ['neutral', [95, 118, 260, 140]],
        ['paragraph', [95, 145, 500, 195], { split: 'gap' }],
        ['heading', [65, 212, 230, 233], { level: 2 }],
        ['paragraph', [65, 252, 240, 275]],
      ],
    },
  },
  {
    id: 'real-multicolumn', file: R + 'multicolumn.pdf', kind: 'paper-2col (LaTeX, lorem ipsum)', title: 'Two-Column Document with Lorem Ipsum', source: 'py-pdf/sample-files 026-latex-multicolumn (CC BY-SA/ public test file)',
    keepHyphen: [],
    pages: {
      1: [
        ['heading', [150, 145, 460, 170], { level: 1 }], ['neutral', [250, 175, 360, 222]],
        ['heading', [70, 238, 140, 258], { level: 2 }],
        ['paragraph', [70, 260, 302, 680]],
        ['paragraph', [305, 240, 545, 680], { cont: true }],
        ['page-number', [290, 685, 320, 710]],
      ],
      2: [
        ['paragraph', [70, 115, 302, 680], { cont: true }],
        ['paragraph', [305, 115, 545, 680], { cont: true }],
        ['page-number', [290, 685, 320, 710]],
      ],
    },
  },
];
