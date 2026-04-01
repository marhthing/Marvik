import axios from 'axios';

export async function fetchProfilePictureBuffer(client, jid) {
  try {
    const url = await client.profilePictureUrl(jid, 'image');
    if (!url) return null;
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return Buffer.from(response.data);
  } catch {
    return null;
  }
}
