import axios from 'axios';

const COUNTRY_ALIASES = {
  UK: 'GB'
};

function normalizeCountryCode(value = '') {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return '';
  return COUNTRY_ALIASES[code] || code;
}

function normalizePostalCode(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePostalCodeForLookup(countryCode, postalCode) {
  const normalizedCountry = normalizeCountryCode(countryCode);
  const normalizedPostalCode = normalizePostalCode(postalCode);

  if (normalizedCountry === 'GB') {
    return normalizedPostalCode.toUpperCase();
  }

  return normalizedPostalCode;
}

export function parsePostalLookupInput(args = []) {
  const tokens = Array.isArray(args) ? args.map((item) => String(item || '').trim()).filter(Boolean) : [];
  if (tokens.length < 2) {
    return { countryCode: '', postalCode: '' };
  }

  const first = normalizeCountryCode(tokens[0]);
  if (/^[A-Z]{2}$/.test(first)) {
    return {
      countryCode: first,
      postalCode: normalizePostalCode(tokens.slice(1).join(' '))
    };
  }

  const last = normalizeCountryCode(tokens[tokens.length - 1]);
  if (/^[A-Z]{2}$/.test(last)) {
    return {
      countryCode: last,
      postalCode: normalizePostalCode(tokens.slice(0, -1).join(' '))
    };
  }

  return { countryCode: '', postalCode: normalizePostalCode(tokens.join(' ')) };
}

async function lookupUnitedKingdomPostcode(postalCode) {
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(normalizePostalCodeForLookup('GB', postalCode))}`;
  const response = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    validateStatus: () => true
  });

  if (response.status === 404 || response.data?.status === 404 || !response.data?.result) {
    return null;
  }

  if (response.status !== 200) {
    throw new Error('Failed to fetch postal code details.');
  }

  const result = response.data.result;
  const placeName = [result.parish, result.admin_ward].filter(Boolean).join(', ');

  return {
    postalCode: result.postcode || normalizePostalCode(postalCode),
    country: result.country || 'United Kingdom',
    countryCode: 'GB',
    places: [
      {
        placeName: placeName || result.admin_district || '',
        state: result.admin_district || '',
        stateAbbreviation: result.region || '',
        longitude: result.longitude != null ? String(result.longitude) : '',
        latitude: result.latitude != null ? String(result.latitude) : ''
      }
    ]
  };
}

export async function lookupPostalCode(countryCode, postalCode) {
  const normalizedCountry = normalizeCountryCode(countryCode);
  const normalizedPostalCode = normalizePostalCodeForLookup(normalizedCountry, postalCode);

  if (!normalizedCountry || !normalizedPostalCode) {
    throw new Error('Please provide a country code and postal code.');
  }

  if (normalizedCountry === 'GB') {
    return lookupUnitedKingdomPostcode(normalizedPostalCode);
  }

  const url = `https://api.zippopotam.us/${encodeURIComponent(normalizedCountry)}/${encodeURIComponent(normalizedPostalCode)}`;
  const response = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    validateStatus: () => true
  });

  if (response.status === 404) {
    return null;
  }

  if (response.status !== 200 || !response.data) {
    throw new Error('Failed to fetch postal code details.');
  }

  const places = Array.isArray(response.data.places)
    ? response.data.places.map((place) => ({
        placeName: place['place name'] || '',
        state: place.state || '',
        stateAbbreviation: place['state abbreviation'] || '',
        longitude: place.longitude || '',
        latitude: place.latitude || ''
      }))
    : [];

  return {
    postalCode: response.data['post code'] || normalizedPostalCode,
    country: response.data.country || '',
    countryCode: response.data['country abbreviation'] || normalizedCountry,
    places
  };
}
