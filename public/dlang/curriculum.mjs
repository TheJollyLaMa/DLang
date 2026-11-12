// Family curriculum: levels ordered the way a child meets words at home —
// pointing at nearby things first, then counting, feelings, colors and the
// first verbs that narrate daily life. Machine-seeded translations are
// clearly marked and remain unreviewed by fluent speakers.
import { CONCEPTS } from './scenes.mjs';
export const SEED_REVIEW = 'machine seed — fluent-speaker review pending';
export const NUMBER_CONCEPTS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const FEELING_CONCEPTS = ['happy', 'sad', 'angry', 'scared', 'tired', 'surprised', 'calm', 'proud'];
export const COLOR_CONCEPTS = ['red', 'blue', 'yellow', 'green', 'black', 'white', 'orange', 'purple'];
export const VERB_CONCEPTS = ['eat', 'drink', 'sleep', 'run', 'walk', 'jump', 'look', 'listen', 'play', 'give'];
export const HOME_EXTRA_CONCEPTS = ['bed', 'sofa', 'door', 'window', 'bottle', 'bowl', 'plate', 'spoon', 'fork', 'knife', 'apple', 'banana', 'carrot', 'bread', 'hat', 'shoe', 'bag', 'umbrella', 'dog', 'fish', 'boat', 'car', 'house', 'bridge'];
// startDay staggers scene complexity across the year library: the first week
// repeats the same dozen home objects, then the world slowly widens.
export const LEVELS = [
  { id: 1, title: 'Pointing at home', kind: 'nouns', startDay: 0, concepts: CONCEPTS },
  { id: 2, title: 'Around the house and town', kind: 'nouns', startDay: 7, concepts: HOME_EXTRA_CONCEPTS },
  { id: 3, title: 'Counting what we see', kind: 'numbers', startDay: 21, concepts: NUMBER_CONCEPTS },
  { id: 4, title: 'How we feel', kind: 'feelings', startDay: 35, concepts: FEELING_CONCEPTS },
  { id: 5, title: 'Naming the colors', kind: 'colors', startDay: 49, concepts: COLOR_CONCEPTS },
  { id: 6, title: 'First verbs', kind: 'verbs', startDay: 63, concepts: VERB_CONCEPTS }
];
export const CURRICULUM_CONCEPTS = LEVELS.flatMap(level => level.concepts);
export function levelForDay(day) {
  if (!Number.isInteger(day) || day < 0) return null;
  return LEVELS.filter(level => day >= level.startDay).at(-1) || null;
}
// Languages shown in the word map. speech is a BCP 47 tag for labeled device
// speech synthesis; null means no synthetic voice is offered (Diné bizaad).
export const WORDMAP_LANGUAGES = [
  { tag: 'es', duo: 'es', name: 'Español', speech: 'es-ES' },
  { tag: 'en', duo: null, name: 'English', speech: 'en-US' },
  { tag: 'fr', duo: 'fr', name: 'Français', speech: 'fr-FR' },
  { tag: 'de', duo: 'de', name: 'Deutsch', speech: 'de-DE' },
  { tag: 'hi', duo: 'hi', name: 'हिन्दी', speech: 'hi-IN' },
  { tag: 'ar', duo: 'ar', name: 'العربية', speech: 'ar-SA' },
  { tag: 'zh-Hans', duo: 'zh', name: '简体中文', speech: 'zh-CN' },
  { tag: 'fi', duo: 'fi', name: 'Suomi', speech: 'fi-FI' },
  { tag: 'nv', duo: 'nv', name: 'Diné bizaad', speech: null },
  { tag: 'ga', duo: 'ga', name: 'Gaeilge', speech: 'ga-IE' },
  { tag: 'el', duo: 'el', name: 'Ελληνικά', speech: 'el-GR' },
  { tag: 'ru', duo: 'ru', name: 'Русский', speech: 'ru-RU' },
  { tag: 'he', duo: 'he', name: 'עברית', speech: 'he-IL' }
];
// Seed labels for languages beyond the five graded study packs:
// [concept, de, ar, fi, ga, el, ru, he, nv]. null = no confident seed;
// Diné bizaad entries are limited to well-attested everyday nouns, numbers
// and colors rather than guessed inflections.
const rows = [
  ['chair', 'Stuhl', 'كرسي', 'tuoli', 'cathaoir', 'καρέκλα', 'стул', 'כיסא', null],
  ['table', 'Tisch', 'طاولة', 'pöytä', 'bord', 'τραπέζι', 'стол', 'שולחן', null],
  ['book', 'Buch', 'كتاب', 'kirja', 'leabhar', 'βιβλίο', 'книга', 'ספר', 'naaltsoos'],
  ['cup', 'Tasse', 'كوب', 'kuppi', 'cupán', 'φλιτζάνι', 'чашка', 'כוס', null],
  ['lamp', 'Lampe', 'مصباح', 'lamppu', 'lampa', 'λάμπα', 'лампа', 'מנורה', null],
  ['cat', 'Katze', 'قطة', 'kissa', 'cat', 'γάτα', 'кошка', 'חתול', 'mósí'],
  ['bird', 'Vogel', 'طائر', 'lintu', 'éan', 'πουλί', 'птица', 'ציפור', 'tsídii'],
  ['tree', 'Baum', 'شجرة', 'puu', 'crann', 'δέντρο', 'дерево', 'עץ', 'tsin'],
  ['flower', 'Blume', 'زهرة', 'kukka', 'bláth', 'λουλούδι', 'цветок', 'פרח', null],
  ['bicycle', 'Fahrrad', 'دراجة', 'polkupyörä', 'rothar', 'ποδήλατο', 'велосипед', 'אופניים', null],
  ['basket', 'Korb', 'سلة', 'kori', 'ciseán', 'καλάθι', 'корзина', 'סל', "ts'aa'"],
  ['clock', 'Uhr', 'ساعة', 'kello', 'clog', 'ρολόι', 'часы', 'שעון', null],
  ['bed', 'Bett', 'سرير', 'sänky', 'leaba', 'κρεβάτι', 'кровать', 'מיטה', "tsásk'eh"],
  ['sofa', 'Sofa', 'أريكة', 'sohva', 'tolg', 'καναπές', 'диван', 'ספה', null],
  ['door', 'Tür', 'باب', 'ovi', 'doras', 'πόρτα', 'дверь', 'דלת', null],
  ['window', 'Fenster', 'نافذة', 'ikkuna', 'fuinneog', 'παράθυρο', 'окно', 'חלון', null],
  ['bottle', 'Flasche', 'زجاجة', 'pullo', 'buidéal', 'μπουκάλι', 'бутылка', 'בקבוק', null],
  ['bowl', 'Schüssel', 'وعاء', 'kulho', 'babhla', 'μπολ', 'миска', 'קערה', null],
  ['plate', 'Teller', 'طبق', 'lautanen', 'pláta', 'πιάτο', 'тарелка', 'צלחת', null],
  ['spoon', 'Löffel', 'ملعقة', 'lusikka', 'spúnóg', 'κουτάλι', 'ложка', 'כף', null],
  ['fork', 'Gabel', 'شوكة', 'haarukka', 'forc', 'πιρούνι', 'вилка', 'מזלג', null],
  ['knife', 'Messer', 'سكين', 'veitsi', 'scian', 'μαχαίρι', 'нож', 'סכין', 'béésh'],
  ['apple', 'Apfel', 'تفاحة', 'omena', 'úll', 'μήλο', 'яблоко', 'תפוח', 'bilasáana'],
  ['banana', 'Banane', 'موزة', 'banaani', 'banana', 'μπανάνα', 'банан', 'בננה', null],
  ['carrot', 'Karotte', 'جزرة', 'porkkana', 'cairéad', 'καρότο', 'морковь', 'גזר', null],
  ['bread', 'Brot', 'خبز', 'leipä', 'arán', 'ψωμί', 'хлеб', 'לחם', 'bááh'],
  ['hat', 'Hut', 'قبعة', 'hattu', 'hata', 'καπέλο', 'шляпа', 'כובע', "ch'ah"],
  ['shoe', 'Schuh', 'حذاء', 'kenkä', 'bróg', 'παπούτσι', 'ботинок', 'נעל', 'ké'],
  ['bag', 'Tasche', 'حقيبة', 'laukku', 'mála', 'τσάντα', 'сумка', 'תיק', null],
  ['umbrella', 'Regenschirm', 'مظلة', 'sateenvarjo', 'scáth fearthainne', 'ομπρέλα', 'зонт', 'מטרייה', null],
  ['dog', 'Hund', 'كلب', 'koira', 'madra', 'σκύλος', 'собака', 'כלב', "łééchąą'í"],
  ['fish', 'Fisch', 'سمكة', 'kala', 'iasc', 'ψάρι', 'рыба', 'דג', "łóó'"],
  ['boat', 'Boot', 'قارب', 'vene', 'bád', 'βάρκα', 'лодка', 'סירה', "tsinaa'eeł"],
  ['car', 'Auto', 'سيارة', 'auto', 'carr', 'αυτοκίνητο', 'машина', 'מכונית', 'chidí'],
  ['house', 'Haus', 'منزل', 'talo', 'teach', 'σπίτι', 'дом', 'בית', 'kin'],
  ['bridge', 'Brücke', 'جسر', 'silta', 'droichead', 'γέφυρα', 'мост', 'גשר', null],
  ['one', 'eins', 'واحد', 'yksi', 'a haon', 'ένα', 'один', 'אחד', "t'ááłá'í"],
  ['two', 'zwei', 'اثنان', 'kaksi', 'a dó', 'δύο', 'два', 'שניים', 'naaki'],
  ['three', 'drei', 'ثلاثة', 'kolme', 'a trí', 'τρία', 'три', 'שלושה', "táá'"],
  ['four', 'vier', 'أربعة', 'neljä', 'a ceathair', 'τέσσερα', 'четыре', 'ארבעה', 'dį́į́ʼ'],
  ['five', 'fünf', 'خمسة', 'viisi', 'a cúig', 'πέντε', 'пять', 'חמישה', "ashdla'"],
  ['six', 'sechs', 'ستة', 'kuusi', 'a sé', 'έξι', 'шесть', 'שישה', 'hastą́ą́'],
  ['seven', 'sieben', 'سبعة', 'seitsemän', 'a seacht', 'επτά', 'семь', 'שבעה', "tsosts'id"],
  ['eight', 'acht', 'ثمانية', 'kahdeksan', 'a hocht', 'οκτώ', 'восемь', 'שמונה', 'tseebíí'],
  ['nine', 'neun', 'تسعة', 'yhdeksän', 'a naoi', 'εννέα', 'девять', 'תשעה', "náhást'éí"],
  ['ten', 'zehn', 'عشرة', 'kymmenen', 'a deich', 'δέκα', 'десять', 'עשרה', 'neeznáá'],
  ['happy', 'glücklich', 'سعيد', 'iloinen', 'sásta', 'χαρούμενος', 'счастливый', 'שמח', null],
  ['sad', 'traurig', 'حزين', 'surullinen', 'brónach', 'λυπημένος', 'грустный', 'עצוב', null],
  ['angry', 'wütend', 'غاضب', 'vihainen', 'feargach', 'θυμωμένος', 'сердитый', 'כועס', null],
  ['scared', 'ängstlich', 'خائف', 'peloissaan', 'scanraithe', 'φοβισμένος', 'испуганный', 'מפוחד', null],
  ['tired', 'müde', 'متعب', 'väsynyt', 'tuirseach', 'κουρασμένος', 'усталый', 'עייף', null],
  ['surprised', 'überrascht', 'متفاجئ', 'yllättynyt', null, 'έκπληκτος', 'удивлённый', 'מופתע', null],
  ['calm', 'ruhig', 'هادئ', 'rauhallinen', 'ciúin', 'ήρεμος', 'спокойный', 'רגוע', null],
  ['proud', 'stolz', 'فخور', 'ylpeä', 'bródúil', 'περήφανος', 'гордый', 'גאה', null],
  ['red', 'rot', 'أحمر', 'punainen', 'dearg', 'κόκκινο', 'красный', 'אדום', "łichíí'"],
  ['blue', 'blau', 'أزرق', 'sininen', 'gorm', 'μπλε', 'синий', 'כחול', "dootł'izh"],
  ['yellow', 'gelb', 'أصفر', 'keltainen', 'buí', 'κίτρινο', 'жёлтый', 'צהוב', 'łitso'],
  ['green', 'grün', 'أخضر', 'vihreä', 'glas', 'πράσινο', 'зелёный', 'ירוק', null],
  ['black', 'schwarz', 'أسود', 'musta', 'dubh', 'μαύρο', 'чёрный', 'שחור', 'łizhin'],
  ['white', 'weiß', 'أبيض', 'valkoinen', 'bán', 'άσπρο', 'белый', 'לבן', 'łigai'],
  ['orange', 'orange', 'برتقالي', 'oranssi', 'oráiste', 'πορτοκαλί', 'оранжевый', 'כתום', null],
  ['purple', 'lila', 'بنفسجي', 'violetti', 'corcra', 'μοβ', 'фиолетовый', 'סגול', null],
  ['eat', 'essen', 'يأكل', 'syödä', 'ith', 'τρώω', 'есть', 'לאכול', null],
  ['drink', 'trinken', 'يشرب', 'juoda', 'ól', 'πίνω', 'пить', 'לשתות', null],
  ['sleep', 'schlafen', 'ينام', 'nukkua', 'codail', 'κοιμάμαι', 'спать', 'לישון', null],
  ['run', 'laufen', 'يركض', 'juosta', 'rith', 'τρέχω', 'бегать', 'לרוץ', null],
  ['walk', 'gehen', 'يمشي', 'kävellä', 'siúil', 'περπατάω', 'ходить', 'ללכת', null],
  ['jump', 'springen', 'يقفز', 'hypätä', 'léim', 'πηδάω', 'прыгать', 'לקפוץ', null],
  ['look', 'schauen', 'ينظر', 'katsoa', 'féach', 'κοιτάζω', 'смотреть', 'להסתכל', null],
  ['listen', 'hören', 'يستمع', 'kuunnella', 'éist', 'ακούω', 'слушать', 'להקשיב', null],
  ['play', 'spielen', 'يلعب', 'leikkiä', 'imir', 'παίζω', 'играть', 'לשחק', null],
  ['give', 'geben', 'يعطي', 'antaa', 'tabhair', 'δίνω', 'давать', 'לתת', null]
];
export const EXTENDED = Object.fromEntries(rows.map(([id, de, ar, fi, ga, el, ru, he, nv]) =>
  [id, { de, ar, fi, ga, el, ru, he, nv, review: SEED_REVIEW }]));
export function levelFor(concept) { return LEVELS.find(level => level.concepts.includes(concept)) || null; }
export function poolForDay(day) {
  return LEVELS.filter(level => day >= level.startDay).flatMap(level => level.concepts);
}
