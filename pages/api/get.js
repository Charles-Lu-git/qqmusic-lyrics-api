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
    
    // 搜索歌曲
    const song = await searchSong(finalTrackName, finalArtistName);
    
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

// 搜索歌曲 - 针对不同类型优化
async function searchSong(trackName, artistName) {
  // 判断歌曲类型并采用不同策略
  if (isJapaneseOrEnglish(trackName)) {
    // 日文/英文歌曲：使用精确匹配策略
    return await searchExactMatch(trackName, artistName);
  } else {
    // 中文歌曲：使用模糊匹配策略
    return await searchChineseSong(trackName, artistName);
  }
}

// 判断是否为日文或英文歌曲
function isJapaneseOrEnglish(text) {
  // 包含日文字符或主要英文单词
  const japaneseChars = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
  const englishKeywords = ['Genshin', 'Impact', 'Anniversary', 'Theme', 'Song', 'Japanese'];
  
  return japaneseChars.test(text) || 
         englishKeywords.some(keyword => text.includes(keyword));
}

// 精确匹配搜索（用于日文/英文歌曲）
async function searchExactMatch(trackName, artistName) {
  const searchKeywords = [
    // 尝试完整标题
    trackName,
    // 提取核心部分（去掉副标题）
    extractMainTitle(trackName),
    // 只搜索艺术家
    artistName
  ];
  
  for (const keyword of searchKeywords) {
    try {
      const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
      console.log('精确搜索:', keyword);
      
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        // 对于精确搜索，我们要求更高的匹配度
        const match = findExactMatch(data.data, trackName, artistName);
        if (match) return match;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn('搜索失败:', error.message);
      continue;
    }
  }
  
  return null;
}

// 中文歌曲搜索（模糊匹配）
async function searchChineseSong(trackName, artistName) {
  const searchKeywords = [
    // 清理后的标题 + 艺术家
    `${cleanChineseTitle(trackName)} ${artistName}`,
    // 只搜索清理后的标题
    cleanChineseTitle(trackName),
    // 原始标题
    trackName
  ];
  
  for (const keyword of searchKeywords) {
    try {
      const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
      console.log('中文搜索:', keyword);
      
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        const match = findChineseMatch(data.data, trackName, artistName);
        if (match) return match;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn('搜索失败:', error.message);
      continue;
    }
  }
  
  return null;
}

// 提取主标题（去掉副标题）
function extractMainTitle(title) {
  // 常见分隔符
  const separators = [' - ', ' – ', ' — ', ' | ', ' // ', ' (', ' [', '【'];
  
  for (const sep of separators) {
    const index = title.indexOf(sep);
    if (index !== -1) {
      return title.substring(0, index).trim();
    }
  }
  
  return title;
}

// 清理中文标题
function cleanChineseTitle(title) {
  return title
    .replace(/[《》【】]/g, '')
    .replace(/[-—–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 精确匹配查找
function findExactMatch(results, targetTrack, targetArtist) {
  const mainTitle = extractMainTitle(targetTrack).toLowerCase();
  
  for (const song of results) {
    const songTitle = (song.name || song.songname || '').toLowerCase();
    const songArtists = extractArtists(song).toLowerCase();
    
    // 检查标题是否匹配（主标题或完整标题）
    const songMainTitle = extractMainTitle(songTitle);
    const titleMatch = songMainTitle === mainTitle || songTitle.includes(mainTitle);
    
    // 检查艺术家是否匹配
    const artistMatch = songArtists.includes(targetArtist.toLowerCase()) || 
                       targetArtist.toLowerCase().includes(songArtists);
    
    if (titleMatch && artistMatch) {
      console.log('找到精确匹配:', songTitle);
      return song;
    }
  }
  
  // 如果没有精确匹配，返回第一个结果
  return results.length > 0 ? results[0] : null;
}

// 中文匹配查找
function findChineseMatch(results, targetTrack, targetArtist) {
  const cleanTarget = cleanChineseTitle(targetTrack).toLowerCase();
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    let score = 0;
    
    const songTitle = (song.name || song.songname || '').toLowerCase();
    const songArtists = extractArtists(song).toLowerCase();
    const cleanSongTitle = cleanChineseTitle(songTitle).toLowerCase();
    
    // 标题匹配
    if (cleanSongTitle === cleanTarget) {
      score += 100;
    } else if (cleanSongTitle.includes(cleanTarget) || cleanTarget.includes(cleanSongTitle)) {
      score += 60;
    }
    
    // 艺术家匹配
    if (songArtists.includes(targetArtist.toLowerCase()) || 
        targetArtist.toLowerCase().includes(songArtists)) {
      score += 50;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
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
