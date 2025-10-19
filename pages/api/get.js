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
  
  const { track_name, artist_name, trackName, artistName } = req.query;
  const finalTrackName = trackName || track_name;
  const finalArtistName = artistName || artist_name;
  
  if (!finalTrackName || !finalArtistName) {
    return res.status(400).json({ 
      error: 'Missing parameters',
      message: 'trackName/track_name 和 artistName/artist_name 参数都是必需的'
    });
  }
  
  try {
    console.log('搜索:', { finalTrackName, finalArtistName });
    
    // 简化搜索逻辑
    const song = await findBestMatch(finalTrackName, finalArtistName);
    
    if (!song) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    console.log('找到歌曲:', song.name || song.songname);
    
    // 获取歌词
    const lyrics = await getLyrics(song.id);
    
    // 构建响应
    const response = {
      id: song.id,
      name: song.name || song.songname || finalTrackName,
      trackName: song.name || song.songname || finalTrackName,
      artistName: extractArtists(song),
      albumName: extractAlbumName(song),
      duration: calculateDuration(song.interval),
      instrumental: !lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '',
      plainLyrics: lyrics.plainLyrics,
      syncedLyrics: lyrics.syncedLyrics
    };
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// 简化版搜索函数
async function findBestMatch(trackName, artistName) {
  // 生成搜索关键词
  const keywords = [
    // 主标题 + 艺术家
    `${cleanTitle(trackName)} ${artistName}`,
    // 只搜索主标题
    cleanTitle(trackName),
    // 艺术家 + 核心关键词
    `${artistName} ${extractCoreChinese(trackName)}`,
    // 原始搜索（备选）
    `${trackName} ${artistName}`
  ];
  
  for (const keyword of keywords) {
    try {
      const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
      console.log('尝试搜索:', keyword);
      
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        const bestMatch = findBestMatchInResults(data.data, trackName, artistName);
        if (bestMatch) return bestMatch;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn('搜索失败:', error.message);
      continue;
    }
  }
  
  return null;
}

// 清理标题
function cleanTitle(title) {
  if (!title) return '';
  
  return title
    .replace(/[《》【】]/g, '') // 移除中文括号
    .replace(/[-—–—]+/g, ' ') // 统一各种横线为空格
    .replace(/\s+/g, ' ') // 合并多个空格
    .trim();
}

// 提取核心中文
function extractCoreChinese(text) {
  const chineseMatch = text.match(/[\u4e00-\u9fff]+/g);
  return chineseMatch ? chineseMatch.join(' ') : '';
}

// 在结果中找最佳匹配
function findBestMatchInResults(results, targetTrack, targetArtist) {
  const cleanTargetTrack = cleanTitle(targetTrack).toLowerCase();
  const cleanTargetArtist = targetArtist.toLowerCase();
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    let score = 0;
    
    const songTitle = (song.name || song.songname || '').toLowerCase();
    const songArtists = extractArtists(song).toLowerCase();
    const cleanSongTitle = cleanTitle(songTitle).toLowerCase();
    
    // 标题匹配
    if (cleanSongTitle === cleanTargetTrack) {
      score += 100;
    } else if (cleanSongTitle.includes(cleanTargetTrack) || cleanTargetTrack.includes(cleanSongTitle)) {
      score += 60;
    }
    
    // 艺术家匹配
    if (songArtists.includes(cleanTargetArtist) || cleanTargetArtist.includes(songArtists)) {
      score += 50;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  // 如果没有完美匹配，返回第一个结果
  return bestMatch || (results.length > 0 ? results[0] : null);
}

// 提取歌手信息
function extractArtists(song) {
  if (!song.singer) return '';
  
  if (Array.isArray(song.singer)) {
    return song.singer.map(s => s.name || s.title || '').filter(Boolean).join(', ');
  } else if (typeof song.singer === 'object') {
    return song.singer.name || song.singer.title || '';
  } else {
    return String(song.singer);
  }
}

// 提取专辑信息
function extractAlbumName(song) {
  if (!song.album) return '';
  
  if (typeof song.album === 'object') {
    return song.album.name || song.album.title || '';
  } else {
    return String(song.album);
  }
}

// 计算时长
function calculateDuration(interval) {
  if (!interval) return 0;
  
  if (typeof interval === 'string') {
    // 处理中文格式 "4分29秒"
    if (interval.includes('分') && interval.includes('秒')) {
      const match = interval.match(/(\d+)分(\d+)秒/);
      if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
    }
    // 处理数字格式 "4:29"
    else if (interval.includes(':')) {
      const [minutes, seconds] = interval.split(':').map(Number);
      if (!isNaN(minutes) && !isNaN(seconds)) return minutes * 60 + seconds;
    }
    // 处理纯数字
    else if (!isNaN(Number(interval))) {
      return Number(interval);
    }
  } else if (typeof interval === 'number') {
    return interval;
  }
  
  return 0;
}

// 获取歌词
async function getLyrics(songId) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    let syncedLyrics = '';
    let plainLyrics = '';
    
    if (data?.code === 200 && data.data?.lrc) {
      syncedLyrics = data.data.lrc;
      plainLyrics = extractPlainLyrics(syncedLyrics);
    }
    
    return { syncedLyrics, plainLyrics };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return { syncedLyrics: '', plainLyrics: '' };
  }
}

// 从LRC歌词中提取纯文本
function extractPlainLyrics(lyricContent) {
  if (!lyricContent) return '';
  
  return lyricContent
    .split('\n')
    .map(line => line
      .replace(/\[\d+:\d+\.\d+\]/g, '')
      .replace(/\[\d+:\d+\]/g, '')
      .replace(/\[.*?\]/g, '')
      .trim()
    )
    .filter(line => line)
    .join('\n');
}
