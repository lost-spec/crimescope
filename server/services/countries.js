/**
 * GNews exposes two different country lists and they are not the same size.
 *
 * `/search`        accepts 37 countries.
 * `/top-headlines` accepts 71 countries, and still accepts a `q` keyword query.
 *
 * The 71-country figure GNews advertises is the top-headlines list. Sending one
 * of the extra 34 to `/search` is rejected, which is why countries outside the
 * 37 are routed to top-headlines instead.
 *
 * Codes are ISO 3166-1 alpha-2, which is also what Nominatim returns from
 * reverse geocoding, so auto-detect lines up without a translation table.
 */

const HEADLINES_COUNTRIES = [
  ['ar', 'Argentina'],
  ['at', 'Austria'],
  ['au', 'Australia'],
  ['bd', 'Bangladesh'],
  ['be', 'Belgium'],
  ['bw', 'Botswana'],
  ['br', 'Brazil'],
  ['bg', 'Bulgaria'],
  ['ca', 'Canada'],
  ['cl', 'Chile'],
  ['cn', 'China'],
  ['co', 'Colombia'],
  ['cu', 'Cuba'],
  ['cz', 'Czechia'],
  ['eg', 'Egypt'],
  ['ee', 'Estonia'],
  ['et', 'Ethiopia'],
  ['fi', 'Finland'],
  ['fr', 'France'],
  ['de', 'Germany'],
  ['gh', 'Ghana'],
  ['gr', 'Greece'],
  ['hk', 'Hong Kong'],
  ['hu', 'Hungary'],
  ['in', 'India'],
  ['id', 'Indonesia'],
  ['ie', 'Ireland'],
  ['il', 'Israel'],
  ['it', 'Italy'],
  ['jp', 'Japan'],
  ['ke', 'Kenya'],
  ['lv', 'Latvia'],
  ['lb', 'Lebanon'],
  ['lt', 'Lithuania'],
  ['my', 'Malaysia'],
  ['mx', 'Mexico'],
  ['ma', 'Morocco'],
  ['na', 'Namibia'],
  ['nl', 'Netherlands'],
  ['nz', 'New Zealand'],
  ['ng', 'Nigeria'],
  ['no', 'Norway'],
  ['pk', 'Pakistan'],
  ['pe', 'Peru'],
  ['ph', 'Philippines'],
  ['pl', 'Poland'],
  ['pt', 'Portugal'],
  ['ro', 'Romania'],
  ['ru', 'Russia'],
  ['sa', 'Saudi Arabia'],
  ['sn', 'Senegal'],
  ['sg', 'Singapore'],
  ['sk', 'Slovakia'],
  ['si', 'Slovenia'],
  ['za', 'South Africa'],
  ['kr', 'South Korea'],
  ['es', 'Spain'],
  ['se', 'Sweden'],
  ['ch', 'Switzerland'],
  ['tw', 'Taiwan'],
  ['tz', 'Tanzania'],
  ['th', 'Thailand'],
  ['tr', 'Turkey'],
  ['ug', 'Uganda'],
  ['ua', 'Ukraine'],
  ['ae', 'United Arab Emirates'],
  ['gb', 'United Kingdom'],
  ['us', 'United States'],
  ['ve', 'Venezuela'],
  ['vn', 'Vietnam'],
  ['zw', 'Zimbabwe'],
];

/** The subset `/search` accepts. Everything else needs `/top-headlines`. */
const SEARCH_CODES = new Set([
  'ar', 'au', 'bd', 'br', 'ca', 'cn', 'co', 'eg', 'fr', 'de', 'gr', 'hk', 'in',
  'id', 'ie', 'il', 'it', 'jp', 'my', 'mx', 'nl', 'no', 'pk', 'pe', 'ph', 'pt',
  'ro', 'ru', 'sg', 'es', 'se', 'ch', 'tw', 'tr', 'ua', 'gb', 'us',
]);

const BY_CODE = new Map(HEADLINES_COUNTRIES);

export const COUNTRIES = HEADLINES_COUNTRIES
  .map(([code, name]) => ({ code: code.toUpperCase(), name, search: SEARCH_CODES.has(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const CODES = new Set(HEADLINES_COUNTRIES.map(([code]) => code));

/** True when GNews indexes this country at all. */
export function isSupported(code) {
  return CODES.has(String(code || '').trim().toLowerCase());
}

/** True when the country can use the `/search` endpoint. */
export function hasSearchSupport(code) {
  return SEARCH_CODES.has(String(code || '').trim().toLowerCase());
}

/** Countries that only work through `/top-headlines`. */
export function needsHeadlines(code) {
  const key = String(code || '').trim().toLowerCase();
  return CODES.has(key) && !SEARCH_CODES.has(key);
}

export function countryName(code) {
  return BY_CODE.get(String(code || '').trim().toLowerCase()) || '';
}