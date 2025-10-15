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
    
    console.log('搜索API完整响应:', JSON.stringify(searchData, null, 2));
    
    if (!searchData || searchData.code !== 200 || !searchData.data || searchData.data.length === 0) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    const song = searchData.data[0];
    console.log('第一首歌曲完整信息:', JSON.stringify(song, null, 2));
    
    // 提取歌手信息
    let artists = '';
    if (song.singer) {
      if (Array.isArray(song.singer)) {
        artists = song.singer.map(s => s.name || s.title || '').filter(Boolean).join(', ');
      } else if (typeof song.singer === 'object') {
        artists = song.singer.name || song.singer.title || '';
      }
    }
    
    // 提取歌曲名称
    const songName = song.name || song.songname || trackName;
    
    // 提取时长
    let duration = '0';
    if (song.interval) {
      duration = (song.interval * 1000).toString();
    }
    
    console.log('解析出的歌曲信息:', {
      id: song.id,
      mid: song.mid,
      name: songName,
      artists: artists,
      duration: duration
    });
    
    // 2. 获取歌词
    let lyricUrl = '';
    if (song.mid) {
      lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?mid=${song.mid}`;
    } else if (song.id) {
      lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${song.id}`;
    } else {
      return res.status(400).json({
        error: 'No song ID',
        message: '歌曲没有有效的ID'
      });
    }
    
    console.log('歌词API URL:', lyricUrl);
    
    const lyricResponse = await axios.get(lyricUrl);
    const lyricData = lyricResponse.data;
    
    console.log('歌词API完整响应:', JSON.stringify(lyricData, null, 2));
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let lyricType = 'none';
    
    if (lyricData && lyricData.code === 200 && lyricData.data) {
      console.log('歌词数据字段:', Object.keys(lyricData.data));
      
      // 只使用 LRC 歌词
      if (lyricData.data.lyric) {
        lyricType = 'lrc';
        let lyricContent = lyricData.data.lyric;
        
        console.log('原始LRC歌词内容 (前200字符):', lyricContent.substring(0, 200));
        
        // 尝试 Base64 解码
        try {
          const decoded = Buffer.from(lyricContent, 'base64').toString('utf-8');
          console.log('Base64解码后的内容 (前200字符):', decoded.substring(0, 200));
          
          // 检查解码后的内容是否包含 LRC 时间标签
          if (decoded.includes('[') && decoded.includes(']')) {
            lyricContent = decoded;
            console.log('LRC Base64 解码成功，使用解码后的内容');
          } else {
            console.log('解码后的内容不是有效的 LRC 格式，使用原始内容');
          }
        } catch (e) {
          console.log('Base64 解码失败，错误信息:', e.message);
          console.log('使用原始歌词内容');
        }
        
        // 使用原始的 LRC 格式作为 syncedLyrics
        syncedLyrics = lyricContent;
        
        // 从 LRC 歌词中提取纯文本
        plainLyrics = extractPlainLyrics(lyricContent);
        
        console.log('最终syncedLyrics长度:', syncedLyrics.length);
        console.log('最终plainLyrics长度:', plainLyrics.length);
      } else {
        console.log('未找到 LRC 歌词字段');
      }
    } else {
      console.log('歌词API返回错误:', lyricData ? lyricData.msg : '未知错误');
    }
    
    // 构建响应
    const response = {
      id: `qq_${song.mid || song.id}`,
      trackName: songName,
      artistName: artists,
      albumName: song.album ? (song.album.name || song.album.title) : '',
      duration: duration,
      plainLyrics: plainLyrics,
      syncedLyrics: syncedLyrics,
      source: 'QQ音乐',
      lyricType: lyricType
    };
    
    // 如果没有歌词，添加提示信息
    if (!syncedLyrics) {
      response.message = '未找到歌词';
    }
    
    console.log('最终响应:', JSON.stringify(response, null, 2));
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// 从 LRC 歌词中提取纯文本
function extractPlainLyrics(lyricContent) {
  if (!lyricContent) return '';
  
  // 移除 LRC 时间标签 [mm:ss.xx] 和可能的其他标签
  const plainText = lyricContent
    .replace(/\[\d+:\d+\.\d+\]/g, '')  // 移除标准时间标签
    .replace(/\[\d+:\d+\]/g, '')       // 移除简化的时间标签
    .replace(/\[.*?\]/g, '')           // 移除其他可能的标签
    .replace(/\s+/g, ' ')              // 合并多个空格
    .trim();
  
  return plainText;
}
