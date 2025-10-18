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
  
  // 使用 LrcLib 标准参数名
  const { track_name, artist_name } = req.query;
  
  if (!track_name || !artist_name) {
    return res.status(400).json({ 
      error: 'Missing parameters',
      message: 'track_name 和 artist_name 参数都是必需的'
    });
  }
  
  try {
    console.log('收到请求:', { track_name, artist_name });
    
    // 1. 搜索歌曲 - 使用 track_name 和 artist_name
    const searchKeyword = `${track_name} ${artist_name}`;
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
    
    // 提取专辑信息
    let albumName = '';
    if (song.album) {
      if (typeof song.album === 'object') {
        albumName = song.album.name || song.album.title || '';
      } else {
        albumName = String(song.album);
      }
    }
    
    // 处理时长转换：将 "分:秒" 格式转换为秒数
    let duration = 0;
    if (song.interval) {
      if (typeof song.interval === 'string' && song.interval.includes(':')) {
        // 处理 "分:秒" 格式，如 "4:29"
        const [minutes, seconds] = song.interval.split(':').map(Number);
        duration = minutes * 60 + seconds;
      } else if (typeof song.interval === 'number') {
        // 如果已经是数字，直接使用（假设单位是秒）
        duration = song.interval;
      } else {
        // 其他情况尝试转换为数字
        duration = Number(song.interval) || 0;
      }
    }
    
    // 2. 获取歌词 - 专门提取lrc字段
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?${song.mid ? `mid=${song.mid}` : `id=${song.id}`}`;
    console.log('歌词URL:', lyricUrl);
    
    const lyricResponse = await axios.get(lyricUrl);
    const lyricData = lyricResponse.data;
    
    console.log('歌词API完整响应:', JSON.stringify(lyricData, null, 2));
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let lyricType = 'none';
    
    if (lyricData && lyricData.code === 200 && lyricData.data) {
      // 专门提取lrc字段
      if (lyricData.data.lrc) {
        console.log("找到LRC歌词字段");
        lyricType = 'lrc';
        syncedLyrics = lyricData.data.lrc; // 直接使用lrc字段的原始数据
        
        console.log(`LRC歌词长度:`, syncedLyrics.length);
        console.log(`LRC歌词预览:`, syncedLyrics.substring(0, 200));
        
        // 从LRC歌词中提取纯文本，保留换行结构
        plainLyrics = extractPlainLyrics(syncedLyrics);
      } else {
        console.log("未找到lrc字段，可用字段:", Object.keys(lyricData.data));
      }
    } else {
      console.log('歌词API返回错误:', lyricData ? lyricData.msg : '未知错误');
    }
    
    // 构建符合新规范的响应（使用新的字段名）
    const response = {
      id: `qq_${song.mid || song.id}`,
      trackName: song.name || song.songname || track_name,  // 改为 trackName
      artistName: artists,  // 改为 artistName
      albumName: albumName,  // 改为 albumName
      duration: duration.toString(),  // 改为秒数格式
      plainLyrics: plainLyrics,  // 改为 plainLyrics
      syncedLyrics: syncedLyrics,  // 改为 syncedLyrics
      source: 'QQ音乐',
      lyric_type: lyricType
    };
    
    // 如果没有歌词，添加提示信息
    if (!syncedLyrics) {
      response.message = '未找到LRC歌词';
    }
    
    console.log('返回响应:', response);
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// 从LRC歌词中提取纯文本，保留换行结构
function extractPlainLyrics(lyricContent) {
  if (!lyricContent) return '';
  
  // 按行处理，保留换行结构
  const lines = lyricContent.split('\n');
  const plainLines = [];
  
  for (const line of lines) {
    // 移除LRC时间标签和其他标签，但保留行内容
    let plainLine = line
      .replace(/\[\d+:\d+\.\d+\]/g, '')  // 移除时间标签 [00:00.00]
      .replace(/\[\d+:\d+\]/g, '')       // 移除简化时间标签 [00:00]
      .replace(/\[ti:.*?\]/g, '')        // 移除标题标签
      .replace(/\[ar:.*?\]/g, '')        // 移除艺术家标签
      .replace(/\[al:.*?\]/g, '')        // 移除专辑标签
      .replace(/\[by:.*?\]/g, '')        // 移除制作人标签
      .replace(/\[offset:.*?\]/g, '')    // 移除偏移标签
      .replace(/\[.*?\]/g, '')           // 移除其他所有标签
      .trim();
    
    // 如果处理后的行不为空，则保留
    if (plainLine) {
      plainLines.push(plainLine);
    }
  }
  
  // 重新组合成带换行的字符串
  return plainLines.join('\n');
}
