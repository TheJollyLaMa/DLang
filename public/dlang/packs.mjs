// Human-authored seed content; not yet reviewed by fluent speakers.
const rows = [
  ['chair', 'chair', 'silla', 'chaise', ['seat'], ['la silla'], ['la chaise']],
  ['table', 'table', 'mesa', 'table', [], ['la mesa'], ['la table']],
  ['book', 'book', 'libro', 'livre', [], ['el libro'], ['le livre']],
  ['cup', 'cup', 'taza', 'tasse', ['mug'], ['la taza'], ['la tasse']],
  ['lamp', 'lamp', 'lámpara', 'lampe', [], ['lampara', 'la lámpara'], ['la lampe']],
  ['cat', 'cat', 'gato', 'chat', [], ['el gato', 'gata'], ['le chat', 'chatte']],
  ['bird', 'bird', 'pájaro', 'oiseau', [], ['pajaro', 'ave', 'el pájaro'], ["l’oiseau", "l'oiseau"]],
  ['tree', 'tree', 'árbol', 'arbre', [], ['arbol', 'el árbol'], ["l’arbre", "l'arbre"]],
  ['flower', 'flower', 'flor', 'fleur', [], ['la flor'], ['la fleur']],
  ['bicycle', 'bicycle', 'bicicleta', 'vélo', ['bike'], ['bici', 'la bicicleta'], ['velo', 'bicyclette', 'le vélo']],
  ['basket', 'basket', 'cesta', 'panier', [], ['canasta', 'la cesta'], ['le panier']],
  ['clock', 'clock', 'reloj', 'horloge', [], ['el reloj'], ["l’horloge", "l'horloge"]]
];
export const PACKS = Object.fromEntries(['en', 'es', 'fr'].map((tag, index) => [tag, Object.fromEntries(rows.map(row => [row[0], { label: row[index + 1], aliases: row[index + 4], review: 'seed — fluent-speaker review pending' }]))]));
const additional = [
  ['chair', 'कुर्सी', ['कुरसी'], '椅子', 'yǐzi', []],
  ['table', 'मेज़', ['मेज'], '桌子', 'zhuōzi', []],
  ['book', 'किताब', ['पुस्तक'], '书', 'shū', []],
  ['cup', 'कप', ['प्याला'], '杯子', 'bēizi', []],
  ['lamp', 'लैंप', ['लैम्प'], '灯', 'dēng', ['台灯']],
  ['cat', 'बिल्ली', [], '猫', 'māo', []],
  ['bird', 'पक्षी', ['चिड़िया'], '鸟', 'niǎo', []],
  ['tree', 'पेड़', ['वृक्ष'], '树', 'shù', []],
  ['flower', 'फूल', ['पुष्प'], '花', 'huā', []],
  ['bicycle', 'साइकिल', [], '自行车', 'zìxíngchē', []],
  ['basket', 'टोकरी', [], '篮子', 'lánzi', []],
  ['clock', 'घड़ी', [], '钟', 'zhōng', ['时钟', '钟表']]
];
PACKS.hi = Object.fromEntries(additional.map(([id, label, aliases]) => [id, { label, aliases, review: 'seed — fluent-speaker review pending' }]));
PACKS['zh-Hans'] = Object.fromEntries(additional.map(([id, , , label, reading, aliases]) => [id, {
  label, reading, readingTag: 'zh-Latn-pinyin', aliases, review: 'seed — fluent-speaker review pending',
  answerPolicy: 'Simplified Chinese characters only. Pinyin is a study aid, not an accepted answer.'
}]));
export const LANGUAGE_NAMES = { en: 'English', es: 'Español', fr: 'Français', hi: 'हिन्दी · Hindi', 'zh-Hans': '简体中文 · Mandarin' };
export const LANGUAGE_TAGS = Object.freeze(Object.keys(PACKS));
const expanded = [
  ['bed', 'bed', 'cama', 'lit', 'बिस्तर', '床', 'chuáng'],
  ['sofa', 'sofa', 'sofá', 'canapé', 'सोफ़ा', '沙发', 'shāfā'],
  ['door', 'door', 'puerta', 'porte', 'दरवाज़ा', '门', 'mén'],
  ['window', 'window', 'ventana', 'fenêtre', 'खिड़की', '窗户', 'chuānghu'],
  ['bottle', 'bottle', 'botella', 'bouteille', 'बोतल', '瓶子', 'píngzi'],
  ['bowl', 'bowl', 'cuenco', 'bol', 'कटोरा', '碗', 'wǎn'],
  ['plate', 'plate', 'plato', 'assiette', 'थाली', '盘子', 'pánzi'],
  ['spoon', 'spoon', 'cuchara', 'cuillère', 'चम्मच', '勺子', 'sháozi'],
  ['fork', 'fork', 'tenedor', 'fourchette', 'कांटा', '叉子', 'chāzi'],
  ['knife', 'knife', 'cuchillo', 'couteau', 'चाकू', '刀', 'dāo'],
  ['apple', 'apple', 'manzana', 'pomme', 'सेब', '苹果', 'píngguǒ'],
  ['banana', 'banana', 'plátano', 'banane', 'केला', '香蕉', 'xiāngjiāo'],
  ['carrot', 'carrot', 'zanahoria', 'carotte', 'गाजर', '胡萝卜', 'húluóbo'],
  ['bread', 'bread', 'pan', 'pain', 'रोटी', '面包', 'miànbāo'],
  ['hat', 'hat', 'sombrero', 'chapeau', 'टोपी', '帽子', 'màozi'],
  ['shoe', 'shoe', 'zapato', 'chaussure', 'जूता', '鞋子', 'xiézi'],
  ['bag', 'bag', 'bolsa', 'sac', 'बैग', '包', 'bāo'],
  ['umbrella', 'umbrella', 'paraguas', 'parapluie', 'छाता', '雨伞', 'yǔsǎn'],
  ['dog', 'dog', 'perro', 'chien', 'कुत्ता', '狗', 'gǒu'],
  ['fish', 'fish', 'pez', 'poisson', 'मछली', '鱼', 'yú'],
  ['boat', 'boat', 'barco', 'bateau', 'नाव', '船', 'chuán'],
  ['car', 'car', 'coche', 'voiture', 'कार', '汽车', 'qìchē'],
  ['house', 'house', 'casa', 'maison', 'घर', '房子', 'fángzi'],
  ['bridge', 'bridge', 'puente', 'pont', 'पुल', '桥', 'qiáo']
];
for (const row of expanded) {
  for (const [index, tag] of LANGUAGE_TAGS.entries()) PACKS[tag][row[0]] = {
    label: row[index + 1], aliases: [], review: 'seed — fluent-speaker review pending',
    ...(tag === 'zh-Hans' ? { reading: row[6], readingTag: 'zh-Latn-pinyin', answerPolicy: 'Chinese characters only; pinyin study-only.' } : {})
  };
}
