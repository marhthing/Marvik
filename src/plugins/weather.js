/**
 * Weather plugin
 */
import axios from 'axios';

export default {
  name: 'weather',
  description: 'Get weather for a city',
  version: '1.0.0',
  author: 'MATDEV',
  commands: [
    {
      name: 'weather',
      description: 'Get weather for a city',
      usage: '.weather <city>',
      category: 'utils',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply('Please provide a city name.');
        const city = ctx.args.join(' ');
        try {
          const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=895284fb2d2c1d87a42248c0211bc2cb&units=metric`);
          const data = res.data;
          const text = `☁️ *Weather in ${data.name}*
🌡️ *Temp:* ${data.main.temp}°C
💧 *Humidity:* ${data.main.humidity}%
🌬️ *Wind:* ${data.wind.speed} m/s
📝 *Condition:* ${data.weather[0].description}`;
          await ctx.reply(text);
        } catch (error) {
          await ctx.reply('❌ City not found or API error.');
        }
      }
    }
  ]
};
