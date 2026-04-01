import axios from 'axios';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.pinterest.com/',
  DNT: '1',
  Connection: 'keep-alive'
};

async function resolvePinterestShortUrl(url) {
  let cleanUrl = String(url || '').trim();
  if (!cleanUrl) return { url: '', failed: false };
  if (!cleanUrl.startsWith('http')) cleanUrl = `https://${cleanUrl}`;

  if (!cleanUrl.includes('pin.it')) {
    return { url: cleanUrl, failed: false };
  }

  const response = await axios.get(cleanUrl, {
    headers: HEADERS,
    maxRedirects: 5,
    validateStatus: () => true
  });
  const finalUrl = response.request.res.responseUrl || cleanUrl;
  const failed = /pinterest\.com\/\?show_error=true/i.test(finalUrl);
  return { url: finalUrl, failed };
}

export async function getPinterestFileSize(url) {
  try {
    const head = await axios.head(url, {
      timeout: 10000,
      headers: HEADERS
    });
    return head.headers['content-length'] ? parseInt(head.headers['content-length'], 10) : 0;
  } catch {
    return 0;
  }
}

export async function validatePinterestUrl(url) {
  const pinterestUrlRegex = /(?:https?:\/\/)?(?:www\.)?(?:pinterest\.com\/pin\/|pin\.it\/)([a-zA-Z0-9_-]+)/;
  if (!url || typeof url !== 'string') return null;

  let cleanUrl = url.trim();
  try {
    const resolved = await resolvePinterestShortUrl(cleanUrl);
    if (resolved.failed) return { failedShortLink: true };
    cleanUrl = resolved.url;

    const match = pinterestUrlRegex.exec(cleanUrl);
    if (!match) return null;

    return {
      url: cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`,
      pinId: match[1]
    };
  } catch {
    return null;
  }
}

function extractAllJsonData(html) {
  const jsonBlocks = [];
  const pwsMatch = html.match(/<script[^>]*id="__PWS_DATA__"[^>]*>(.*?)<\/script>/s);
  if (pwsMatch?.[1]) {
    try { jsonBlocks.push(JSON.parse(pwsMatch[1])); } catch {}
  }

  const scriptMatches = html.matchAll(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gs);
  for (const match of scriptMatches) {
    try { jsonBlocks.push(JSON.parse(match[1])); } catch {}
  }
  return jsonBlocks;
}

function findVideoQualities(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  const qualities = [];

  if (obj.video_list && typeof obj.video_list === 'object') {
    const qualityOrder = ['V_720P', 'V_480P', 'V_360P', 'V_HLSV4', 'V_HLSV3_MOBILE', 'V_EXP7', 'V_EXP6', 'V_EXP5'];
    for (const quality of qualityOrder) {
      if (obj.video_list[quality]?.url) {
        let label = quality.replace('V_', '').replace('P', 'p');
        if (label.includes('HLS')) label = 'HLS Stream';
        if (label.includes('EXP')) label = 'Standard';
        qualities.push({
          quality: label,
          url: obj.video_list[quality].url,
          width: obj.video_list[quality].width || 0,
          height: obj.video_list[quality].height || 0
        });
      }
    }

    if (qualities.length === 0) {
      for (const key in obj.video_list) {
        if (obj.video_list[key]?.url) {
          qualities.push({
            quality: key.replace('V_', '').replace('P', 'p'),
            url: obj.video_list[key].url,
            width: obj.video_list[key].width || 0,
            height: obj.video_list[key].height || 0
          });
        }
      }
    }
  }

  if (qualities.length > 0) return qualities;
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      const result = findVideoQualities(obj[key], depth + 1);
      if (result.length > 0) return result;
    }
  }
  return [];
}

function findImageQualities(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  const qualities = [];

  if (obj.images && typeof obj.images === 'object') {
    const qualityOrder = ['orig', '1200x', '736x', '564x', '474x', '236x', '170x'];
    for (const quality of qualityOrder) {
      if (obj.images[quality]?.url) {
        qualities.push({
          quality: quality === 'orig' ? 'Original' : quality,
          url: obj.images[quality].url,
          width: obj.images[quality].width || 0,
          height: obj.images[quality].height || 0
        });
      }
    }
  }

  if (qualities.length > 0) return qualities;
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      const result = findImageQualities(obj[key], depth + 1);
      if (result.length > 0) return result;
    }
  }
  return [];
}


export function extractPinterestUrlFromObject(obj) {
  const urlRegex = /https?:\/\/(?:www\.)?(?:pinterest\.com\/pin\/|pin\.it\/)[a-zA-Z0-9_-]+/i;
  if (!obj || typeof obj !== 'object') return null;
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      const match = obj[key].match(urlRegex);
      if (match) return match[0];
    } else if (typeof obj[key] === 'object') {
      const found = extractPinterestUrlFromObject(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

export async function getPinterestMediaInfo(url) {
  const response = await axios.get(url, { headers: HEADERS, timeout: 30000 });
  const html = response.data;
  const jsonBlocks = extractAllJsonData(html);

  let videoQualities = [];
  let imageQualities = [];

  for (const jsonData of jsonBlocks) {
    videoQualities = findVideoQualities(jsonData);
    if (videoQualities.length > 0) break;
  }

  if (videoQualities.length === 0) {
    for (const jsonData of jsonBlocks) {
      imageQualities = findImageQualities(jsonData);
      if (imageQualities.length > 0) break;
    }
  }

  if (videoQualities.length === 0 && imageQualities.length === 0) {
    const videoPatterns = [
      /"url":"(https:\/\/[^"]*\.mp4[^"]*)"/,
      /"V_720P":\{"url":"([^"]+)"/,
      /"video_list":[^}]*"url":"([^"]+\.mp4[^"]*)"/
    ];
    for (const pattern of videoPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const videoUrl = match[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        videoQualities.push({ quality: 'Standard', url: videoUrl, width: 0, height: 0 });
        break;
      }
    }

    if (videoQualities.length === 0) {
      const imagePatterns = [
        /"url":"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/,
        /"orig":\{"url":"([^"]+)"/
      ];
      for (const pattern of imagePatterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
          const imageUrl = match[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
          imageQualities.push({ quality: 'Original', url: imageUrl, width: 0, height: 0 });
          break;
        }
      }
    }
  }

  if (videoQualities.length === 0 && imageQualities.length === 0) {
    throw new Error('Could not extract media URL from Pinterest page');
  }

  return {
    isVideo: videoQualities.length > 0,
    videoQualities,
    imageQualities
  };
}

export async function downloadPinterestMediaToBuffer(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: HEADERS
  });
  return Buffer.from(response.data);
}
