import { lookupPostalCode, parsePostalLookupInput } from '../domains/address/postalCode.js';

function formatPlace(place = {}) {
  const parts = [
    place.placeName,
    place.stateAbbreviation || place.state
  ].filter(Boolean);

  const lines = [parts.join(', ')];

  if (place.state && place.stateAbbreviation && place.state !== place.stateAbbreviation) {
    lines.push(`State: ${place.state}`);
  }

  if (place.latitude && place.longitude) {
    lines.push(`Coordinates: ${place.latitude}, ${place.longitude}`);
  }

  return lines.join('\n');
}

export default {
  name: 'pincode',
  description: 'Look up postal code details for supported countries',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'pincode',
      aliases: ['postcode', 'zipcode', 'postal'],
      description: 'Look up a postal code using a country code',
      usage: '.pincode <countryCode> <postalCode>',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        const { countryCode, postalCode } = parsePostalLookupInput(ctx.args);

        if (!countryCode || !postalCode) {
          await ctx.reply([
            'Usage: .pincode <countryCode> <postalCode>',
            'Examples:',
            '.pincode GB CF37 2PU',
            '.pincode US 10001',
            '.pincode IN 110001'
          ].join('\n'));
          return;
        }

        try {
          const result = await lookupPostalCode(countryCode, postalCode);
          if (!result) {
            await ctx.reply(`No postal code result found for ${countryCode} ${postalCode}.`);
            return;
          }

          const lines = [
            '*Postal Code Lookup*',
            `Postal code: ${result.postalCode}`,
            `Country: ${result.country} (${result.countryCode})`
          ];

          if (result.places.length) {
            lines.push('');
            lines.push('*Places:*');
            result.places.slice(0, 5).forEach((place, index) => {
              lines.push(`${index + 1}. ${formatPlace(place)}`);
            });
          }

          await ctx.reply(lines.join('\n'));
        } catch (error) {
          await ctx.reply(error.message || 'Failed to look up the postal code.');
        }
      }
    }
  ]
};
