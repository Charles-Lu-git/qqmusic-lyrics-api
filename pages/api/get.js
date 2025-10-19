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
    console.log('搜索请求:', { 
      trackName: finalTrackName, 
      artistName: finalArtistName,
      length: finalTrackName.length
    });
    
    // 直接搜索 - 使用最简单的策略
    const song = await directSearch(finalTrackName, finalArtistName);
    
    if (!song) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    console.log('找到歌曲:', {
      name: song.name || song.songname,
      artist: extractArtists(song),
      id: song.id
    });
    
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

// 直接搜索函数 - 专注于解决问题
async function directSearch(trackName, artistName) {
  // 针对长标题的特殊处理
  if (trackName.length > 30) {
    console.log('检测到长标题，使用简化搜索');
    return await searchLongTitle(trackName, artistName);
  }
  
  // 正常搜索流程
  const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(trackName + ' ' + artistName)}`;
  console.log('搜索URL:', searchUrl);
  
  const response = await axios.get(searchUrl);
  const data = response.data;
  
  if (data?.code === 200 && data.data?.length > 0) {
    return findBestMatch(data.data, trackName, artistName);
  }
  
  return null;
}

// 专门处理长标题的搜索
async function searchLongTitle(trackName, artistName) {
  console.log('原始标题长度:', trackName.length);
  console.log('原始标题:', trackName);
  
  // 尝试不同的搜索策略
  const strategies = [
    // 策略1: 只提取日文部分
    () => {
      const japanesePart = extractJapanesePart(trackName);
      console.log('策略1 - 日文部分:', japanesePart);
      return japanesePart + ' ' + artistName;
    },
    // 策略2: 提取第一个部分（直到第一个分隔符）
    () => {
      const firstPart = extractFirstPart(trackName);
      console.log('策略2 - 第一部分:', firstPart);
      return firstPart + ' ' + artistName;
    },
    // 策略3: 只搜索艺术家（作为备选）
    () => {
      console.log('策略3 - 只搜索艺术家:', artistName);
      return artistName;
    },
    // 策略4: 使用核心关键词
    () => {
      const keywords = extractKeywords(trackName);
      console.log('策略4 - 关键词:', keywords);
      return keywords + ' ' + artistName;
    }
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    try {
      const keyword = strategies[i]();
      const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
      console.log(`策略${i+1} 搜索URL:`, searchUrl);
      
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        const match = findBestMatch(data.data, trackName, artistName);
        if (match) {
          console.log(`策略${i+1} 成功找到匹配`);
          return match;
        }
      }
      
      // 短暂延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.warn(`策略${i+1} 失败:`, error.message);
      continue;
    }
  }
  
  return null;
}

// 提取日文部分
function extractJapanesePart(text) {
  // 匹配日文字符
  const japaneseMatch = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  return japaneseMatch ? japaneseMatch[0] : text.split(/[-\s]/)[0];
}

// 提取第一部分（直到第一个分隔符）
function extractFirstPart(text) {
  const separators = [' - ', ' – ', ' — ', ' | ', ' // '];
  for (const sep of separators) {
    const index = text.indexOf(sep);
    if (index !== -1) {
      return text.substring(0, index).trim();
    }
  }
  return text.split(/\s+/)[0]; // 返回第一个单词
}

// 提取关键词
function extractKeywords(text) {
  // 移除常见修饰词
  const modifiers = [
    'Genshin Impact\'s', 'Anniversary', 'Japanese', 'Theme', 'Song',
    '原神', '周年', '主题曲', '日文版'
  ];
  
  let result = text;
  modifiers.forEach(mod => {
    result = result.replace(new RegExp(mod, 'gi'), '');
  });
  
  // 清理多余空格和特殊字符
  return result.replace(/\s+/g, ' ').replace(/[^\w\u4e00-\u9fff\s]/g, '').trim();
}

// 查找最佳匹配
function findBestMatch(results, targetTrack, targetArtist) {
  console.log(`在 ${results.length} 个结果中查找最佳匹配`);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    const score = calculateMatchScore(song, targetTrack, targetArtist);
    
    console.log(`检查歌曲: "${song.name || song.songname}" - 分数: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  if (bestMatch) {
    console.log(`最佳匹配: "${bestMatch.name || bestMatch.songname}" - 分数: ${bestScore}`);
  } else if (results.length > 0) {
    console.log('没有高分数匹配，返回第一个结果');
    bestMatch = results[0];
  }
  
  return bestMatch;
}

// 计算匹配分数
function calculateMatchScore(song, targetTrack, targetArtist) {
  let score = 0;
  
  const songTitle = (song.name || song.songname || '').toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  const targetArtistLower = targetArtist.toLowerCase();
  
  // 标题匹配
  if (songTitle === targetTrackLower) {
    score += 100;
  } else if (songTitle.includes(targetTrackLower) || targetTrackLower.includes(songTitle)) {
    score += 60;
  } else {
    // 检查部分匹配
    const songWords = songTitle.split(/\s+/);
    const targetWords = targetTrackLower.split(/\s+/);
    
    const commonWords = songWords.filter(word => 
      targetWords.some(targetWord => targetWord.includes(word) || word.includes(targetWord))
    );
    
    if (commonWords.length > 0) {
      score += commonWords.length * 10;
    }
  }
  
  // 艺术家匹配
  if (songArtists.includes(targetArtistLower) || targetArtistLower.includes(songArtists)) {
    score += 50;
  }
  
  return score;
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
