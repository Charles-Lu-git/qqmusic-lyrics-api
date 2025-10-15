import axios from 'axios';

export default async function handler(req, res) {
  // CORS 设置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { trackName, artistName } = req.query;
  
  if (!trackName) {
    return res.status(400).json({ 
      error: 'Missing parameter',
      message: 'trackName 参数是必需的'
    });
  }
  
  try {
    console.log('收到请求:', { trackName, artistName });
    
    // 1. 搜索歌曲
    const searchKeyword = artistName ? `${trackName} ${artistName}` : trackName;
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(searchKeyword)}`;
    
    console.log('搜索URL:', searchUrl);
    const searchResponse = await axios.get(searchUrl);
    const searchData = searchResponse.data;
    
    if (!searchData || searchData.code !== 200 || !searchData.data || searchData.data.length === 0) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    const song = searchData.data[0];
    console.log('找到歌曲:', song);
    
    // 提取歌手信息
    let artists = '';
    if (song.singer) {
      if (Array.isArray(song.singer)) {
        artists = song.singer.map(s => s.name || s.title || '').filter(Boolean).join(', ');
      } else if (typeof song.singer === 'object') {
        artists = song.singer.name || song.singer.title || '';
      }
    }
    
    // 2. 获取歌词
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?${song.mid ? `mid=${song.mid}` : `id=${song.id}`}`;
    console.log('歌词URL:', lyricUrl);
    
    const lyricResponse = await axios.get(lyricUrl);
    const lyricData = lyricResponse.data;
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let lyricType = 'none';
    
    if (lyricData && lyricData.code === 200 && lyricData.data) {
      let lyricContent = '';
      
      // 优先使用 YRC
      if (lyricData.data.yrc) {
        lyricType = 'yrc';
        lyricContent = lyricData.data.yrc;
        try {
          const decoded = Buffer.from(lyricContent, 'base64').toString('utf-8');
          if (decoded.includes('[') || decoded.includes('<')) {
            lyricContent = decoded;
          }
        } catch (e) {
          console.log('YRC 解码失败，使用原始内容');
        }
      } 
      // 使用 LRC
      else if (lyricData.data.lyric) {
        lyricType = 'lrc';
        lyricContent = lyricData.data.lyric;
        try {
          const decoded = Buffer.from(lyricContent, 'base64').toString('utf-8');
          if (decoded.includes('[')) {
            lyricContent = decoded;
          }
        } catch (e) {
          console.log('LRC 解码失败，使用原始内容');
        }
      }
      
      syncedLyrics = lyricContent;
      plainLyrics = lyricContent
        .replace(/\[\d+:\d+\.\d+\]/g, '')
        .replace(/<\d+\.\d+\.\d+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    // 构建响应
    const response = {
      id: `qq_${song.mid || song.id}`,
      trackName: song.name || song.songname || '',
      artistName: artists,
      albumName: song.album ? (song.album.name || song.album.title) : '',
      duration: song.interval ? (song.interval * 1000).toString() : '0',
      plainLyrics: plainLyrics,
      syncedLyrics: syncedLyrics,
      source: 'QQ音乐',
      lyricType: lyricType
    };
    
    console.log('返回响应');
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
