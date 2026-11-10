export const CONCEPTS = ['chair', 'table', 'book', 'cup', 'lamp', 'cat', 'bird', 'tree', 'flower', 'bicycle', 'basket', 'clock'];
export const DESCRIPTIONS = {
  chair: 'Raised sitting surface with a backrest and four supports',
  table: 'Broad flat top supported above the floor',
  book: 'Bound pages inside a cover',
  cup: 'Small handled drinking vessel',
  lamp: 'Shade over an electric light on a support',
  cat: 'Small whiskered animal with pointed ears and a tail',
  bird: 'Feathered animal with wings and a beak',
  tree: 'Woody trunk topped with branches and foliage',
  flower: 'Petals surrounding a center on a leafy stem',
  bicycle: 'Two wheels joined by a pedal-driven frame',
  basket: 'Open carrying container with a handle',
  clock: 'Face with two hands indicating the time'
};
const settings = [
  ['The greenhouse workshop', '#d2e7cf', '#ceaa77', '#38645b', 0],
  ['Harbour café at dawn', '#c4e6f4', '#b7b2a1', '#285c82', 1],
  ['The attic observatory', '#d4c8ee', '#b79273', '#694b84', 2],
  ['Orchard picnic', '#cbe6b2', '#91b77c', '#9c4c43', 3],
  ['Lantern market', '#ecd8c0', '#cf9d86', '#b45d36', 4],
  ['Winter reading room', '#d3e2ef', '#adbec9', '#345a77', 5],
  ['Courtyard celebration', '#f3d9a8', '#caaa8d', '#a54869', 6]
];
const positions = [[125,294,72,100],[304,318,160,80],[580,315,60,44],[366,266,45,43],[734,203,65,123],[636,444,88,60],[580,125,65,55],[79,61,125,175],[490,443,55,72],[777,430,155,100],[249,450,80,74],[414,65,65,65]];
export const SCENES = settings.map(([title, sky, ground, accent, variant], day) => ({
  id: `scene-${day + 1}`, title, sky, ground, accent, variant,
  targets: CONCEPTS.map((concept, i) => {
    const [x,y,w,h] = positions[i];
    return { id: `d${day + 1}-${concept}`, concept, box: [x + (day % 3) * 5, y + ((day + i) % 3) * 4, w, h], exemplar: `${concept}-${day + 1}` };
  })
}));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function object(concept, v, color) {
  const wood = ['#7c4835','#c59665','#536979','#b45d41','#927c45','#64777e','#8d5b78'][v];
  const common = `stroke="#283f46" stroke-width="2.5" stroke-linejoin="round"`;
  const shapes = {
    chair: `<path d="M12 12 Q50 ${v % 2 ? -8 : 10} 86 12 L80 60 H16Z" fill="${wood}"/><path d="M12 58 H88 V72 H12Z" fill="${color}"/><path d="M20 72 L14 98 M79 72 L88 98 M25 20 V53 M70 20 V53" fill="none"/>`,
    table: `<path d="M3 30 Q50 ${v % 2 ? 0 : 20} 97 30 L92 50 H8Z" fill="${wood}"/><path d="M20 50 L14 97 M78 50 L90 97 M10 56 H88" fill="none"/>`,
    book: `<path d="M6 18 L46 5 L94 18 V88 L50 75 L6 92Z" fill="${color}"/><path d="M50 75 V15 M13 30 L40 20 M58 28 L85 36 M58 45 L85 53 M13 49 L40 39" fill="none" stroke="#fff2c9"/>`,
    cup: `<path d="M15 12 H70 L64 86 Q40 98 21 86Z" fill="${color}"/><path d="M70 25 Q110 20 86 65 H68" fill="none"/><path d="M25 35 H62 M29 50 H57" stroke="#fff3cd"/>`,
    lamp: `<path d="M48 30 V87 M19 94 H82" fill="none"/><path d="M28 4 H72 L96 37 H4Z" fill="${v % 2 ? '#f0d091' : color}"/><ellipse cx="50" cy="94" rx="33" ry="5" fill="${wood}"/>`,
    cat: `<path d="M9 75 Q-9 12 17 45 M22 82 Q8 38 41 36 L45 9 L61 25 L80 8 L87 45 Q105 83 65 93Z" fill="${v % 2 ? '#d38c57' : '#697a89'}"/><path d="M52 48 H56 M72 48 H76 M61 60 L67 64 L72 58 M38 59 L56 63 M77 63 L96 60" fill="none"/>`,
    bird: `<path d="M12 78 Q23 28 56 34 Q66 8 84 30 L98 39 L83 46 Q82 83 43 85Z" fill="${color}"/><path d="M24 64 Q55 30 63 64 Q42 80 24 64" fill="#edc97d"/><circle cx="76" cy="34" r="3" fill="#172f37"/><path d="M42 84 L38 97 M52 84 L56 97" fill="none"/>`,
    tree: `<path d="M45 37 H57 L68 100 H33Z" fill="${wood}"/><path d="M11 70 Q-11 38 21 28 Q15 0 49 6 Q86 -9 83 26 Q112 36 87 69Z" fill="${['#44785b','#73834c','#557567','#63883f','#78874b','#64878c','#6f9257'][v]}"/><path d="M50 75 L28 52 M54 60 L74 38" fill="none"/>`,
    flower: `<path d="M50 42 V98 M50 79 Q12 60 17 88Z M52 70 Q85 40 90 67Z" fill="#598855"/><g fill="${v % 2 ? '#f0ba55' : '#e289a5'}"><circle cx="32" cy="26" r="18"/><circle cx="66" cy="25" r="18"/><circle cx="49" cy="12" r="18"/><circle cx="49" cy="44" r="18"/></g><circle cx="49" cy="28" r="13" fill="#f3d57f"/>`,
    bicycle: `<g fill="none"><circle cx="20" cy="70" r="22"/><circle cx="79" cy="70" r="22"/><path d="M20 70 L39 29 L57 70 H20 L66 30 L79 70 M31 28 H47 M62 15 H74 L66 30" stroke="${color}" stroke-width="5"/><path d="M20 70 L5 55 M20 70 L35 85 M79 70 L65 85 M79 70 L93 54" stroke-width="1"/></g>`,
    basket: `<path d="M7 39 H94 L81 94 H20Z" fill="${wood}"/><path d="M25 40 Q23 -12 76 8 Q87 16 77 40 M13 54 H89 M17 71 H85 M30 41 L37 93 M51 41 V93 M73 41 L65 93" fill="none" stroke="#e9c78e"/>`,
    clock: `<${v % 2 ? 'rect x="4" y="4" width="92" height="92" rx="12"' : 'circle cx="50" cy="50" r="46"'} fill="#f6e8c6"/><path d="M50 16 V23 M50 78 V85 M15 50 H23 M78 50 H85 M50 50 V29 M50 50 L72 ${v % 2 ? 62 : 40}" fill="none"/><circle cx="50" cy="50" r="4" fill="${color}"/>`
  };
  const alternate = v % 3 === 1 ? {
    chair: `<path d="M10 19 Q51 -1 90 19 L80 65 H18Z" fill="${wood}"/><path d="M16 62 H87 V78 H16Z" fill="#e1c49c"/><path d="M23 78 L15 96 M78 78 L87 96 M10 44 H26 M75 44 H94" fill="none"/>`,
    table: `<ellipse cx="50" cy="27" rx="47" ry="23" fill="${wood}"/><path d="M45 46 H56 L60 88 L88 98 H12 L43 88Z" fill="${color}"/>`,
    book: `<path d="M17 7 H88 V94 H17 Q2 88 8 77 V18Z" fill="${color}"/><path d="M20 78 H88 V90 H20 Q11 83 20 78Z" fill="#f3e7c7"/><path d="M24 7 V76 M34 22 H74 M34 33 H65" stroke="#eacb8c" fill="none"/>`,
    cup: `<path d="M20 8 H76 V78 Q49 97 20 78Z" fill="#f6e8ca"/><path d="M76 22 H94 Q105 58 76 64" fill="none"/><path d="M23 26 H73 M23 39 H73 M23 52 H73" stroke="${color}" stroke-width="8"/><ellipse cx="48" cy="8" rx="28" ry="7" fill="#7e5946"/>`,
    lamp: `<path d="M20 96 H79 M49 94 L26 61 L62 24 M20 58 L31 66" fill="none" stroke-width="7"/><path d="M57 12 Q86 5 97 44 L52 53 Q40 31 57 12Z" fill="${color}"/><path d="M57 47 L91 40" stroke="#f6d893" stroke-width="6"/>`,
    cat: `<path d="M75 75 Q110 60 93 47 M8 67 Q1 36 42 39 L63 50 Q89 48 86 82 L13 87Z" fill="#dca46c"/><path d="M8 50 L4 14 L23 27 L39 13 L43 53Z" fill="#dca46c"/><path d="M11 40 H16 M29 40 H34 M20 48 L25 51 M48 59 L66 66 M40 71 L62 76" fill="none"/>`,
    bird: `<path d="M7 68 L29 56 Q14 23 39 5 L58 42 Q75 12 90 37 L99 41 L87 48 Q97 75 58 81 L29 70Z" fill="${color}"/><path d="M38 20 L49 45 M45 74 L40 94 M59 77 L65 94" fill="none"/><circle cx="80" cy="38" r="3"/>`,
    tree: `<path d="M44 74 H57 V100 H44Z" fill="${wood}"/><path d="M49 0 L77 29 H65 L92 58 H74 L100 84 H0 L26 58 H8 L35 29 H23Z" fill="#47766b"/><path d="M24 72 H76 M34 49 H67 M42 26 H58" stroke="#a9c5a1" fill="none"/>`,
    flower: `<path d="M49 49 V100 M49 91 Q6 72 22 58 Q42 70 49 91 M49 76 Q90 47 86 79Z" fill="#4a8a62"/><path d="M16 13 Q29 31 35 6 L51 25 L72 3 Q68 31 89 12 L79 45 Q50 74 25 43Z" fill="${color}"/>`,
    bicycle: `<g fill="none"><circle cx="21" cy="72" r="21"/><circle cx="78" cy="72" r="21"/><path d="M21 72 L41 33 L55 73 L78 72 L65 29 L43 60 L21 72 M34 32 H48 M65 29 L69 14 H82" stroke="${color}" stroke-width="5"/><path d="M2 40 H29 L25 54 H8Z" fill="#d8ab65"/><path d="M12 41 V52 M20 41 V52"/></g>`,
    basket: `<path d="M4 35 H96 V88 Q52 108 4 88Z" fill="#bc9064"/><path d="M12 37 Q15 0 49 0 Q87 0 90 37 M9 51 Q50 72 91 51 M9 72 Q50 93 91 72 M25 40 V95 M48 40 V100 M73 40 V96" fill="none" stroke="#e9c78e"/>`,
    clock: `<path d="M9 34 Q50 -12 90 34 V87 H99 V98 H0 V87 H9Z" fill="${wood}"/><circle cx="50" cy="47" r="31" fill="#f2deb5"/><path d="M50 24 V47 L68 59 M48 73 V90" fill="none"/><circle cx="48" cy="89" r="5" fill="#e0b26e"/>`
  } : v % 3 === 2 ? {
    chair: `<path d="M17 7 H83 V61 H17Z" fill="${color}"/><path d="M21 16 H79 M21 29 H79 M21 43 H79" stroke="#e2bb8d" stroke-width="5"/><path d="M7 61 H93 V75 H7Z" fill="${wood}"/><path d="M21 75 V92 M77 75 V92 M4 93 Q50 105 97 93" fill="none" stroke-width="5"/>`,
    table: `<path d="M1 7 H99 V32 H1Z" fill="#bc9470"/><path d="M8 14 H94 M8 23 H94" stroke="${wood}" fill="none"/><path d="M22 32 L9 98 M76 32 L91 98 M14 76 H86 M26 34 L76 95 M74 34 L26 95" stroke="${color}" stroke-width="6" fill="none"/>`,
    book: `<path d="M4 18 L90 7 V29 L4 40Z" fill="${color}"/><path d="M10 42 L98 33 V57 L10 68Z" fill="${wood}"/><path d="M1 72 L90 61 V88 L1 99Z" fill="#cfa568"/><path d="M10 28 L83 19 M18 52 L92 43 M9 83 L83 72" stroke="#f9edce" stroke-width="7"/>`,
    cup: `<path d="M12 12 H70 L80 76 Q50 99 24 83Z" fill="${wood}"/><path d="M75 33 Q102 18 98 58 Q95 70 79 72" fill="none" stroke-width="6"/><path d="M17 32 L74 47 M23 59 L77 69" stroke="#f3c678" stroke-width="9"/><ellipse cx="41" cy="12" rx="29" ry="8" fill="#5c4d42"/>`,
    lamp: `<path d="M47 0 V15 M47 50 V93 M17 98 H80" fill="none"/><path d="M19 18 L47 7 L82 19 L91 48 H5Z" fill="#ead096"/><path d="M20 20 L76 42 M18 40 L73 20" fill="none" stroke="${color}" stroke-width="5"/>`,
    cat: `<path d="M89 66 Q106 99 59 95 Q13 102 7 69 Q3 43 29 38 Q34 11 67 22 L77 11 L81 38 Q98 57 78 71 Q56 82 40 65" fill="#8d8a7a"/><path d="M43 32 L48 37 M62 42 L69 45 M28 74 Q33 92 65 84" fill="none" stroke="#f4dcc1"/><path d="M14 64 L24 70 M21 48 L33 56" stroke="#354d53" fill="none"/>`,
    bird: `<path d="M6 80 L30 57 Q27 15 61 24 Q91 8 88 42 L99 48 L82 51 Q68 81 37 78Z" fill="#d5aa64"/><path d="M30 52 Q49 30 67 52 L42 74Z" fill="${color}"/><circle cx="76" cy="33" r="3"/><path d="M43 79 V97 M57 79 V97 M20 93 H80" fill="none"/>`,
    tree: `<path d="M48 20 L64 100 H40 L40 23Z" fill="${wood}"/><path d="M48 25 Q8 -15 1 36 Q19 10 43 31 Q5 20 9 64 Q26 33 47 33 Q29 65 43 73 L56 32 Q80 39 97 68 Q105 30 62 26 Q94 8 100 34 Q104 -10 53 24Z" fill="#579074"/>`,
    flower: `<path d="M50 25 V100 M50 85 L22 61 M50 65 L85 48" stroke="#498467" stroke-width="6" fill="none"/><g fill="#eac56c"><circle cx="49" cy="19" r="19"/><circle cx="19" cy="53" r="15"/><circle cx="84" cy="39" r="15"/></g><g fill="${color}"><circle cx="49" cy="19" r="7"/><circle cx="19" cy="53" r="6"/><circle cx="84" cy="39" r="6"/></g>`,
    bicycle: `<g fill="none"><circle cx="19" cy="73" r="20"/><circle cx="81" cy="73" r="20"/><path d="M19 73 L38 28 L55 73 L74 40 L81 73 M19 73 H55 L38 28 M29 27 H45 M72 41 L67 14 H80" stroke="${wood}" stroke-width="6"/><path d="M1 45 H25 M68 48 Q87 35 100 59" stroke="${color}" stroke-width="4"/></g>`,
    basket: `<path d="M0 22 H100 L83 92 H17Z" fill="${color}"/><path d="M16 22 V7 H84 V22" fill="none" stroke-width="6"/><path d="M13 38 H87 M17 56 H83 M20 76 H80 M28 27 V89 M49 27 V92 M72 27 V89" fill="none" stroke="#e1bd87" stroke-width="5"/>`,
    clock: `<path d="M20 0 H80 V99 H20Z" fill="${wood}"/><circle cx="50" cy="28" r="23" fill="#f3e4c3"/><path d="M50 12 V28 L65 32 M50 56 V80" fill="none"/><circle cx="50" cy="82" r="10" fill="#d4aa66"/><path d="M27 96 H74" stroke="#e9c58f" stroke-width="4"/>`
  } : null;
  return `<g ${common}>${alternate?.[concept] || shapes[concept]}</g>`;
}
export function sceneSVG(scene, { study = false, correct = [] } = {}) {
  const v = scene.variant;
  const decor = Array.from({length: 16}, (_, i) => `<path d="M${30+i*61} ${190+(i%3)*15} l22 -38 l26 38Z" fill="${i%2 ? '#739b8d' : '#a9bd9c'}" opacity=".55"/><path d="M${i*73} 554 l36 -15 l35 15" fill="none" stroke="#ffffff55"/>`).join('');
  const windows = Array.from({length:3}, (_,i)=> `<g transform="translate(${210+i*230} 55)"><path d="M0 140 V20 Q65 -20 130 20 V140Z" fill="${scene.sky}" stroke="${scene.accent}" stroke-width="9"/><path d="M65 0 V140 M0 75 H130" stroke="${scene.accent}" stroke-width="4"/><path d="M5 132 L60 96 L125 132" fill="#709b98" opacity=".5"/></g>`).join('');
  const backdrops = [
    `<path d="M0 230 V70 L500 -40 L1000 70 V230 M0 70 H1000 M180 0 V232 M360 0 V232 M550 0 V232 M740 0 V232 M920 0 V232" fill="none" stroke="#718d78" stroke-width="12"/>${windows}<g fill="#d2a27c">${[240,650,850].map(x=>`<path d="M${x} 227 l12 48 h45 l12 -48Z"/><path d="M${x+15} 226 q-25 -60 15 -48 q20 -55 30 -25 q30 5 -10 73" fill="#69906b"/>`).join('')}</g>`,
    `${windows}<path d="M0 196 Q90 176 190 195 T390 195 T590 195 T790 195 T1000 195 V237 H0Z" fill="#76b2c4"/><path d="M260 164 L340 164 L320 185 H278Z M680 164 H755 L736 184 H699Z" fill="#735749"/><path d="M301 110 V164 H346Z M716 115 V164 H760Z" fill="#fff3d4"/><path d="M5 252 H995 M5 277 H995 M5 303 H995" stroke="#b09a7a" stroke-width="3"/><g fill="#f3e8ce"><path d="M468 211 H548 V229 H468Z"/><path d="M476 218 H540" stroke="#b49265"/></g>`,
    `<path d="M0 222 L490 -80 L1000 222" stroke="#6d5775" stroke-width="40" fill="#a89ac1"/><circle cx="293" cy="114" r="77" fill="#536782" stroke="#715e77" stroke-width="12"/><path d="M294 40 V188 M220 112 H366" stroke="#bfc9da" stroke-width="5"/><g fill="#f3e1a1">${[0,1,2,3,4,5,6].map(i=>`<circle cx="${240+i*17}" cy="${85+(i%3)*22}" r="2"/>`).join('')}</g><path d="M847 140 L926 94 L940 116 L862 162Z" fill="#bba882"/><path d="M883 146 L867 215 M883 146 L933 215" stroke="#4e4b64" stroke-width="6"/>`,
    `<path d="M0 240 Q250 90 500 235 Q750 100 1000 235Z" fill="#8fb779"/><path d="M0 225 Q200 176 400 226 T800 226 T1200 226" fill="none" stroke="#759769" stroke-width="6"/><path d="M165 340 L610 310 L740 580 L130 590Z" fill="#f3d8ad"/><path d="M184 364 L620 342 M160 425 L650 398 M145 499 L692 478 M240 335 L205 580 M340 328 L360 582 M444 320 L525 580 M550 315 L680 580" stroke="#c47d68" stroke-width="12" opacity=".6"/><path d="M874 85 L950 214 H800Z" fill="#e1c794"/><path d="M874 85 V217" stroke="#796b4e" stroke-width="5"/>`,
    `<path d="M0 38 H1000 V83 Q950 116 900 83 Q850 116 800 83 Q750 116 700 83 Q650 116 600 83 Q550 116 500 83 Q450 116 400 83 Q350 116 300 83 Q250 116 200 83 Q150 116 100 83 Q50 116 0 83Z" fill="#c87155"/><path d="M100 38 V92 M300 38 V92 M500 38 V92 M700 38 V92 M900 38 V92" stroke="#f1d7ad" stroke-width="70"/><path d="M15 97 V245 M985 97 V245" stroke="#785c48" stroke-width="12"/><path d="M205 203 H363 V244 H205 M656 183 H942 V237 H656" fill="#9d7051"/><g fill="#e9b957">${[0,1,2,3,4,5,6,7,8].map(i=>`<ellipse cx="${665+i*31}" cy="${165+(i%2)*7}" rx="16" ry="12"/>`).join('')}</g><path d="M237 112 Q266 83 293 112 V164 H237Z" fill="#e7c484"/><path d="M238 127 H292 M264 99 V162" stroke="#b78757" stroke-width="3"/>`,
    `${windows}<g fill="#fffdf5">${Array.from({length:25},(_,i)=>`<circle cx="${226+(i*109)%590}" cy="${67+(i*37)%120}" r="${2+i%3}"/>`).join('')}</g><path d="M8 247 H1000" stroke="#e9f1e8" stroke-width="12"/><path d="M858 240 H968 V405 H858Z" fill="#69667a"/><path d="M866 252 H960 V361 H866Z" fill="#e7bc82"/><path d="M884 358 Q880 289 909 325 Q917 271 937 344 L948 358Z" fill="#d4835e"/><path d="M865 374 H960 M870 387 H951" stroke="#c7b9ac" stroke-width="5"/>`,
    `<path d="M0 0 H1000 V238 H0Z" fill="#d9b795"/><path d="M211 235 V90 Q274 4 338 90 V235 M652 235 V90 Q715 4 779 90 V235" fill="#85b5b2" stroke="#b78c73" stroke-width="18"/><path d="M0 238 H1000" stroke="#b78c73" stroke-width="8"/><path d="M790 347 Q873 260 969 347 L938 365 H818Z" fill="#a6c8c0"/><path d="M876 287 V341 M848 348 Q874 324 908 347" stroke="#d4f0e2" stroke-width="5" fill="none"/><path d="M15 500 Q120 410 242 541" fill="none" stroke="#d0bb99" stroke-width="10"/>`
  ];
  const texture = `<g opacity=".36" stroke="#674f3e" stroke-width="1.5" fill="none">${Array.from({length:18},(_,i)=>`<path d="M${i*69-80} 249 L${i*90-140} 600"/>`).join('')}<path d="M0 475 H1000 M0 563 H1000"/></g>`;
  const props = `<g stroke="#45605a" stroke-width="2">
    <path d="M540 366 H680 V380 H540Z M553 380 V429 M667 380 V429" fill="#ae825b"/>
    <path d="M710 332 H824 V403 H710Z" fill="#ab8560"/><path d="M722 343 H811 V364 H722Z M722 374 H811 V393 H722Z" fill="#c6a37b"/><circle cx="765" cy="353" r="3" fill="#e1c59b"/><circle cx="765" cy="384" r="3" fill="#e1c59b"/>
    <path d="M268 311 H452 V322 H268Z" fill="#9f7b58"/><path d="M279 308 V279 H300 V308Z" fill="#99b8a8"/><path d="M281 279 H298 M282 288 H296" fill="none"/>
    <path d="M319 307 V289 Q330 277 341 289 V307Z" fill="#d0a45f"/><path d="M323 287 L320 268 M335 287 L340 271" fill="none"/>
    <path d="M571 183 H666" stroke="#8c7158" stroke-width="5"/><path d="M585 186 L577 202 M653 186 L660 202" fill="none"/>
    <path d="M24 459 L158 442 L179 553 L42 565Z" fill="#b9957c"/><path d="M43 477 L146 464 M48 496 L153 482 M51 517 L157 501 M57 539 L163 522" stroke="#e8c89f" stroke-width="7"/>
    <path d="M41 447 L46 317 L90 306 L105 444 M49 341 L94 330 M48 370 L98 359 M47 399 L101 388 M46 427 L104 417" fill="none" stroke="#8a775a" stroke-width="6"/>
    <path d="M199 432 Q221 401 263 429 L283 449 L216 466Z" fill="#d5aa9a"/><path d="M213 434 L245 443 M234 421 L255 432" stroke="#ebcfac"/>
    <path d="M359 504 L435 484 L461 533 L384 555Z" fill="#c5a67c"/><path d="M379 505 L431 494 M384 519 L438 508 M390 534 L446 522" stroke="#e9d1a1"/><path d="M359 504 L384 555 L372 563 L346 515Z" fill="#947a5c"/>
    <path d="M850 411 H975 V424 H850Z" fill="#8d715c"/><path d="M865 405 V380 H880 V405 M902 406 V370 H919 V406 M944 406 V386 H962 V406" fill="#b8c2a1"/>
    <path d="M870 380 L866 363 L878 362 L878 380 M908 370 V356 M950 386 L952 366" fill="none"/>
    <path d="M696 519 Q743 491 778 521 L757 551 H719Z" fill="#799392"/><path d="M705 521 H767 M716 535 H760" stroke="#b8ccba"/>
    <path d="M212 67 V127 L248 158 L265 144 L233 119 V67Z" fill="#d1bc96"/><path d="M217 76 H232 M218 90 H232 M219 104 H233" stroke="#a1825e"/>
    <path d="M808 73 H908 V153 H808Z" fill="#e4d3ab"/><path d="M817 83 H899 V142 H817Z" fill="${scene.sky}"/><path d="M822 137 L853 96 L871 119 L884 108 L897 137Z" fill="${scene.accent}"/>
  </g><g stroke="#6b8c6b" stroke-width="3" fill="none"><path d="M5 8 Q57 26 18 105 Q68 138 18 190 M981 6 Q941 48 979 98 Q940 144 983 192"/>${Array.from({length:12},(_,i)=>`<path d="M${i%2?976:19} ${12+i*15} q${i%2?-28:28} -18 ${i%2?-30:30} 7 q${i%2?24:-24} 12 ${i%2?30:-30} -7Z" fill="#839c72"/>`).join('')}</g>`;
  const targets = scene.targets.map((t, i) => {
    const [x,y,w,h] = t.box;
    const done = correct.includes(t.id);
    return `<g class="scene-target${done ? ' found' : ''}" data-target="${t.id}" role="button" tabindex="0" aria-label="${study ? esc(t.concept) : `Object ${i+1}: ${esc(DESCRIPTIONS[t.concept])}`}${done ? ', found' : ''}" transform="translate(${x} ${y})"><title>${study ? esc(t.concept) : `Object ${i+1}: ${esc(DESCRIPTIONS[t.concept])}`}</title><svg width="${w}" height="${h}" viewBox="-8 -8 116 116" overflow="hidden">${object(t.concept,v,scene.accent)}</svg><rect class="hitbox" width="${w}" height="${h}" rx="7" fill="transparent" stroke="${done ? '#147c4b' : 'transparent'}" stroke-width="5"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 1000 600" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="${esc(scene.title)}: twelve interactive objects. Use the accessible object list below for larger controls."><rect width="1000" height="600" fill="${scene.sky}"/><rect y="235" width="1000" height="365" fill="${scene.ground}"/>${backdrops[v]}${texture}<path d="M0 245 H1000 M0 410 L1000 440" stroke="${scene.accent}" stroke-width="5" opacity=".4"/>${decor}<path d="M0 15 Q500 ${v%2 ? 175 : 80} 1000 15" fill="none" stroke="${scene.accent}" stroke-width="3"/>${Array.from({length:12},(_,i)=>`<path d="M${i*89} ${30+Math.sin(i/4)*24} l25 0 l-12 30Z" fill="${i%2 ? '#e6ab60' : '#d48391'}"/>`).join('')}<g opacity=".65"><ellipse cx="520" cy="561" rx="90" ry="12" fill="#5c6e5c"/><path d="M890 290 H976 V390 H890Z" fill="#a87e60"/><path d="M900 298 H965 M900 322 H965 M900 346 H965 M900 370 H965" stroke="#d7bb8a" stroke-width="6"/><path d="M15 365 L92 340 L98 430 L20 447Z" fill="#d9b786"/><path d="M28 378 l46 -15 M30 397 l47 -15" stroke="#7d7765" stroke-width="5"/></g>${props}${targets}</svg>`;
}
