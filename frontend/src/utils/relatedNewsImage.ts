import type { EventType, NewsItem } from '../types/api';

/** Curated Unsplash crops — large unique catalog + themed preference. */
const U = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=720&h=400&q=80`;

/** Deduped master catalog (~90). List assignment prefers theme, then uniqueness. */
const CATALOG = [
  // markets / charts / trading
  'photo-1611974789855-9c2a0a7236a3',
  'photo-1590283603385-17ffb3a7f29f',
  'photo-1642790551116-18e150f248e3',
  'photo-1535320903710-d7125d7b8a3a',
  'photo-1460925895917-afdab827c52f',
  'photo-1611974789855-9c2a0a7236a3',
  'photo-1559526324-4b87b5e36e44',
  'photo-1642543492481-44e81e3914a7',
  'photo-1621761191319-c6fb62004040',
  'photo-1560221328-12fe60a3513b',
  'photo-1579532537598-905a9f9b1a3d',
  'photo-1633158829585-23ba8f7c8caf',
  // earnings / finance desk
  'photo-1554224155-6726b3ff858f',
  'photo-1551288049-bebda4e38f71',
  'photo-1579621970563-ebec7560ff3e',
  'photo-1553729459-efe14ef6055d',
  'photo-1633158829875-e5316a75af20',
  'photo-1554224154-26032ffc0d07',
  'photo-1450101499163-c8848c66ca85',
  'photo-1551836022-d5d88e9218df',
  'photo-1454165804606-c3d57bc86b40',
  'photo-1543286386-713bdd548da4',
  'photo-1504868584819-f8e8b4b6d7e3',
  // tech / AI / servers
  'photo-1518770660439-4636190af475',
  'photo-1677442136019-21780ecad995',
  'photo-1550751827-4bd374c3f58b',
  'photo-1519389950473-47ba0277781c',
  'photo-1526374965328-7f61d4dc18c5',
  'photo-1558494949-ef010cbdcc31',
  'photo-1555617981-dac3880eac6e',
  'photo-1581091226825-a6a2a5aee158',
  'photo-1518772537832-44d9b5ea0a0d',
  'photo-1581092918056-0c4c3acd3789',
  'photo-1485827404703-89b55fcc595e',
  'photo-1535378917042-10a22c95931a',
  'photo-1620712943543-bcc4688e7485',
  'photo-1488590528505-98d2b5aba04b',
  'photo-1516321318423-f06f85e504b3',
  'photo-1504639725590-34d0984388bd',
  // product / devices
  'photo-1505740420928-5e560c06d30e',
  'photo-1523275335684-37898b6baf30',
  'photo-1498049794561-7780e7231661',
  'photo-1484704849700-f032a568e944',
  'photo-1546868871-7041f2a55e12',
  'photo-1511707171634-5f897ff02aa9',
  'photo-1526170375885-4d8ecf77b99f',
  'photo-1572569511254-d8f925fe2cbb',
  'photo-1583394838336-acd977736f90',
  'photo-1593640408182-31c70c8268f5',
  // regulation / legal / contracts
  'photo-1589829545856-d10d557cf95f',
  'photo-1436450412740-6b988f486c6b',
  'photo-1521791136064-7986c2920216',
  'photo-1507679799987-4e685fb2c5a8',
  'photo-1505664194779-8beaceb93744',
  'photo-1479142506502-19b3a3b7ff33',
  'photo-1450101499163-c8848c66ca85',
  'photo-1589391886645-d51941baf7fb',
  // management / office
  'photo-1600880292203-757bb62b4baf',
  'photo-1556761175-5973dc0f32e7',
  'photo-1521737711867-e3b97375f902',
  'photo-1542744173-8e7e53415bb0',
  'photo-1557804506-669a67965ba0',
  'photo-1517245386807-bb43f82c33c4',
  'photo-1600880292089-90a7e086ee0c',
  'photo-1552664730-d307ca884978',
  // macro / cities / banks
  'photo-1526304640581-d334cdbbf45e',
  'photo-1486406146926-c627a92ad1ab',
  'photo-1444653614773-995cb1ef9efa',
  'photo-1563986768609-322da13575f3',
  'photo-1486406146926-c627a92ad1ab',
  'photo-1449824913935-59a10b8d2000',
  'photo-1477959858617-67f85cf4f1df',
  'photo-1496568816309-51d7c20e3b21',
  // energy
  'photo-1473341304170-971dccb5ac1e',
  'photo-1497435334941-8c899ee9e8e9',
  'photo-1466611653911-95081537e5b7',
  'photo-1509391366360-2e959784a276',
  'photo-1548337138-e87d889cc369',
  'photo-1508514177221-188b1cf16e9d',
  'photo-1473341304170-971dccb5ac1e',
  'photo-1532601224476-15c79f2f7a64',
  // healthcare
  'photo-1576091160399-112ba8d25d1d',
  'photo-1582719478250-c89cae4dc85b',
  'photo-1532187863486-abf9dbad1b69',
  'photo-1579684385127-1ef15d508118',
  'photo-1581595220892-b245f637fdb0',
  'photo-1587854692152-cbe660dbde88',
  'photo-1579154204601-01588f351e67',
  'photo-1631815588090-d4bfec5b1ccb',
  // consumer / retail
  'photo-1441986300917-64674bd600d8',
  'photo-1472851294608-062f624d30b5',
  'photo-1556742049-0cfed4f6a45d',
  'photo-1607082348824-0a96f2a4b9da',
  'photo-1556740738-b6a63e27c4df',
  'photo-1555529902-5261145633bf',
  'photo-1561715276-a2136f0ce5c4',
  // auto / transport
  'photo-1492144534655-ae79c964c9d7',
  'photo-1503376780353-7e6692767b70',
  'photo-1549317661-bd32c8ce0db2',
  'photo-1617788138017-80ad40651399',
  'photo-1560958089-b8a1929cea89',
  'photo-1485291571150-772bcfc10da5',
  'photo-1511919884226-fd3cad54694b',
  'photo-1552519507-da3b142c6e3d',
  // misc business / abstract
  'photo-1507679799987-4e685fb2c5a8',
  'photo-1504384308090-c894fdcc538d',
  'photo-1559136555-9303baea8ebd',
  'photo-1664575602276-acd073f104c1',
  'photo-1556761175-b413da4baf72',
  'photo-1553877522-43269d4ea984',
  'photo-1516321497487-e288fb19713f',
  'photo-1432888498266-38ffec3eaf0a',
].map(U);

/** Unique URLs in catalog order. */
const ALL: string[] = Array.from(new Set(CATALOG));

type Theme =
  | 'markets'
  | 'earnings'
  | 'technology'
  | 'chips'
  | 'product'
  | 'regulation'
  | 'analyst'
  | 'management'
  | 'macro'
  | 'legal'
  | 'energy'
  | 'healthcare'
  | 'consumer'
  | 'auto'
  | 'positive'
  | 'negative';

/** Index ranges into CATALOG before dedupe — rebuilt as URL sets from known ids. */
const THEME_IDS: Record<Theme, string[]> = {
  markets: [
    'photo-1611974789855-9c2a0a7236a3',
    'photo-1590283603385-17ffb3a7f29f',
    'photo-1642790551116-18e150f248e3',
    'photo-1535320903710-d7125d7b8a3a',
    'photo-1460925895917-afdab827c52f',
    'photo-1559526324-4b87b5e36e44',
    'photo-1642543492481-44e81e3914a7',
    'photo-1621761191319-c6fb62004040',
    'photo-1560221328-12fe60a3513b',
    'photo-1579532537598-905a9f9b1a3d',
    'photo-1633158829585-23ba8f7c8caf',
  ],
  earnings: [
    'photo-1554224155-6726b3ff858f',
    'photo-1551288049-bebda4e38f71',
    'photo-1579621970563-ebec7560ff3e',
    'photo-1553729459-efe14ef6055d',
    'photo-1633158829875-e5316a75af20',
    'photo-1554224154-26032ffc0d07',
    'photo-1450101499163-c8848c66ca85',
    'photo-1551836022-d5d88e9218df',
    'photo-1454165804606-c3d57bc86b40',
    'photo-1543286386-713bdd548da4',
    'photo-1504868584819-f8e8b4b6d7e3',
  ],
  technology: [
    'photo-1518770660439-4636190af475',
    'photo-1677442136019-21780ecad995',
    'photo-1550751827-4bd374c3f58b',
    'photo-1519389950473-47ba0277781c',
    'photo-1526374965328-7f61d4dc18c5',
    'photo-1558494949-ef010cbdcc31',
    'photo-1485827404703-89b55fcc595e',
    'photo-1535378917042-10a22c95931a',
    'photo-1620712943543-bcc4688e7485',
    'photo-1488590528505-98d2b5aba04b',
    'photo-1516321318423-f06f85e504b3',
    'photo-1504639725590-34d0984388bd',
  ],
  chips: [
    'photo-1518770660439-4636190af475',
    'photo-1555617981-dac3880eac6e',
    'photo-1581091226825-a6a2a5aee158',
    'photo-1518772537832-44d9b5ea0a0d',
    'photo-1581092918056-0c4c3acd3789',
    'photo-1558494949-ef010cbdcc31',
    'photo-1677442136019-21780ecad995',
    'photo-1485827404703-89b55fcc595e',
    'photo-1620712943543-bcc4688e7485',
    'photo-1488590528505-98d2b5aba04b',
  ],
  product: [
    'photo-1505740420928-5e560c06d30e',
    'photo-1523275335684-37898b6baf30',
    'photo-1498049794561-7780e7231661',
    'photo-1484704849700-f032a568e944',
    'photo-1546868871-7041f2a55e12',
    'photo-1511707171634-5f897ff02aa9',
    'photo-1526170375885-4d8ecf77b99f',
    'photo-1572569511254-d8f925fe2cbb',
    'photo-1583394838336-acd977736f90',
    'photo-1593640408182-31c70c8268f5',
  ],
  regulation: [
    'photo-1589829545856-d10d557cf95f',
    'photo-1436450412740-6b988f486c6b',
    'photo-1521791136064-7986c2920216',
    'photo-1507679799987-4e685fb2c5a8',
    'photo-1505664194779-8beaceb93744',
    'photo-1479142506502-19b3a3b7ff33',
    'photo-1450101499163-c8848c66ca85',
    'photo-1589391886645-d51941baf7fb',
  ],
  analyst: [
    'photo-1551288049-bebda4e38f71',
    'photo-1543286386-713bdd548da4',
    'photo-1504868584819-f8e8b4b6d7e3',
    'photo-1551836022-d5d88e9218df',
    'photo-1454165804606-c3d57bc86b40',
    'photo-1460925895917-afdab827c52f',
    'photo-1559526324-4b87b5e36e44',
    'photo-1633158829585-23ba8f7c8caf',
  ],
  management: [
    'photo-1600880292203-757bb62b4baf',
    'photo-1556761175-5973dc0f32e7',
    'photo-1521737711867-e3b97375f902',
    'photo-1542744173-8e7e53415bb0',
    'photo-1557804506-669a67965ba0',
    'photo-1517245386807-bb43f82c33c4',
    'photo-1600880292089-90a7e086ee0c',
    'photo-1552664730-d307ca884978',
  ],
  macro: [
    'photo-1526304640581-d334cdbbf45e',
    'photo-1486406146926-c627a92ad1ab',
    'photo-1444653614773-995cb1ef9efa',
    'photo-1563986768609-322da13575f3',
    'photo-1449824913935-59a10b8d2000',
    'photo-1477959858617-67f85cf4f1df',
    'photo-1496568816309-51d7c20e3b21',
    'photo-1611974789855-9c2a0a7236a3',
  ],
  legal: [
    'photo-1589829545856-d10d557cf95f',
    'photo-1505664194779-8beaceb93744',
    'photo-1479142506502-19b3a3b7ff33',
    'photo-1436450412740-6b988f486c6b',
    'photo-1450101499163-c8848c66ca85',
    'photo-1589391886645-d51941baf7fb',
    'photo-1521791136064-7986c2920216',
  ],
  energy: [
    'photo-1473341304170-971dccb5ac1e',
    'photo-1497435334941-8c899ee9e8e9',
    'photo-1466611653911-95081537e5b7',
    'photo-1509391366360-2e959784a276',
    'photo-1548337138-e87d889cc369',
    'photo-1508514177221-188b1cf16e9d',
    'photo-1532601224476-15c79f2f7a64',
  ],
  healthcare: [
    'photo-1576091160399-112ba8d25d1d',
    'photo-1582719478250-c89cae4dc85b',
    'photo-1532187863486-abf9dbad1b69',
    'photo-1579684385127-1ef15d508118',
    'photo-1581595220892-b245f637fdb0',
    'photo-1587854692152-cbe660dbde88',
    'photo-1579154204601-01588f351e67',
    'photo-1631815588090-d4bfec5b1ccb',
  ],
  consumer: [
    'photo-1441986300917-64674bd600d8',
    'photo-1472851294608-062f624d30b5',
    'photo-1556742049-0cfed4f6a45d',
    'photo-1607082348824-0a96f2a4b9da',
    'photo-1556740738-b6a63e27c4df',
    'photo-1555529902-5261145633bf',
    'photo-1561715276-a2136f0ce5c4',
    'photo-1526170375885-4d8ecf77b99f',
  ],
  auto: [
    'photo-1492144534655-ae79c964c9d7',
    'photo-1503376780353-7e6692767b70',
    'photo-1549317661-bd32c8ce0db2',
    'photo-1617788138017-80ad40651399',
    'photo-1560958089-b8a1929cea89',
    'photo-1485291571150-772bcfc10da5',
    'photo-1511919884226-fd3cad54694b',
    'photo-1552519507-da3b142c6e3d',
  ],
  positive: [
    'photo-1579621970563-ebec7560ff3e',
    'photo-1553729459-efe14ef6055d',
    'photo-1526304640581-d334cdbbf45e',
    'photo-1611974789855-9c2a0a7236a3',
    'photo-1559526324-4b87b5e36e44',
    'photo-1517245386807-bb43f82c33c4',
  ],
  negative: [
    'photo-1590283603385-17ffb3a7f29f',
    'photo-1642790551116-18e150f248e3',
    'photo-1535320903710-d7125d7b8a3a',
    'photo-1460925895917-afdab827c52f',
    'photo-1642543492481-44e81e3914a7',
    'photo-1504384308090-c894fdcc538d',
  ],
};

const THEME_URLS: Record<Theme, string[]> = Object.fromEntries(
  (Object.keys(THEME_IDS) as Theme[]).map((k) => [k, THEME_IDS[k].map(U)]),
) as Record<Theme, string[]>;

const EVENT_THEME: Partial<Record<EventType, Theme>> = {
  earnings: 'earnings',
  guidance: 'earnings',
  product: 'product',
  regulation: 'regulation',
  analyst: 'analyst',
  management: 'management',
  macro: 'macro',
  legal: 'legal',
  company_update: 'markets',
  other: 'markets',
};

const SYMBOL_THEME: Record<string, Theme> = {
  NVDA: 'chips',
  AMD: 'chips',
  INTC: 'chips',
  AVGO: 'chips',
  TSM: 'chips',
  MU: 'chips',
  AAPL: 'product',
  MSFT: 'technology',
  GOOGL: 'technology',
  GOOG: 'technology',
  META: 'technology',
  AMZN: 'consumer',
  TSLA: 'auto',
  F: 'auto',
  GM: 'auto',
  RIVN: 'auto',
  XOM: 'energy',
  CVX: 'energy',
  COP: 'energy',
  JNJ: 'healthcare',
  PFE: 'healthcare',
  UNH: 'healthcare',
  LLY: 'healthcare',
  WMT: 'consumer',
  COST: 'consumer',
  NKE: 'consumer',
  SBUX: 'consumer',
};

type NewsLike = Pick<NewsItem, 'id' | 'eventType' | 'direction' | 'headline'>;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function headlineTheme(headline: string): Theme | null {
  const h = headline.toLowerCase();
  if (/\b(chip|semiconductor|gpu|ai |artificial intelligence|software|cloud|cyber)\b/.test(h)) {
    return 'technology';
  }
  if (/\b(earnings|revenue|eps|profit|quarterly|guidance|outlook)\b/.test(h)) return 'earnings';
  if (/\b(fda|drug|trial|biotech|pharma|hospital)\b/.test(h)) return 'healthcare';
  if (/\b(oil|gas|energy|crude|solar|battery)\b/.test(h)) return 'energy';
  if (/\b(ev|vehicle|auto|car |truck)\b/.test(h)) return 'auto';
  if (/\b(lawsuit|antitrust|sec |doj|court|settlement)\b/.test(h)) return 'legal';
  if (/\b(fed|inflation|rate cut|rate hike|gdp|treasury)\b/.test(h)) return 'macro';
  if (/\b(iphone|product|launch|device|gadget)\b/.test(h)) return 'product';
  return null;
}

function pickTheme(item: NewsLike, symbol?: string): Theme {
  // Prefer headline / event over symbol so one ticker doesn't collapse to 1 theme.
  const fromHeadline = headlineTheme(item.headline);
  if (fromHeadline) return fromHeadline;
  const fromEvent = EVENT_THEME[item.eventType];
  if (fromEvent) return fromEvent;
  const sym = (symbol || '').toUpperCase();
  if (sym && SYMBOL_THEME[sym]) return SYMBOL_THEME[sym];
  if (item.direction === 'positive') return 'positive';
  if (item.direction === 'negative') return 'negative';
  return 'markets';
}

/** Preferred URLs: theme first, then the rest of the catalog (for uniqueness fill). */
function candidateUrls(item: NewsLike, symbol?: string): string[] {
  const theme = pickTheme(item, symbol);
  const preferred = THEME_URLS[theme] ?? THEME_URLS.markets;
  const prefSet = new Set(preferred);
  const rest = ALL.filter((u) => !prefSet.has(u));
  // Rotate start by id so different items explore preferred in different order.
  const rot = hashSeed(item.id) % preferred.length;
  const rotated = preferred.slice(rot).concat(preferred.slice(0, rot));
  return rotated.concat(rest);
}

/** Single-item pick (detail panel). */
export function relatedNewsImageUrl(item: NewsLike, symbol?: string): string {
  const candidates = candidateUrls(item, symbol);
  return candidates[0] ?? ALL[0]!;
}

/**
 * Assign images for a visible list: keep theme preference, avoid duplicates
 * until the catalog is exhausted.
 */
export function assignRelatedNewsImages(items: NewsLike[], symbol?: string): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();

  for (const item of items) {
    const candidates = candidateUrls(item, symbol);
    let chosen = candidates.find((u) => !used.has(u));
    if (!chosen) {
      // Catalog exhausted — spread repeats by id.
      chosen = ALL[hashSeed(item.id) % ALL.length] ?? ALL[0]!;
    }
    used.add(chosen);
    out.set(item.id, chosen);
  }
  return out;
}
