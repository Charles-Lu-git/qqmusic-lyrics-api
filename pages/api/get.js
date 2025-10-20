import axios from 'axios';

// 中英文歌名映射表 - 包含艺术家信息避免混淆
const englishToChineseMap = {
  // 林宥嘉
  'unrequited_林宥嘉': '浪费',
  'fool_林宥嘉': '傻子',
  'who doesn’t wanna_林宥嘉': '谁不想',
  // 动力火车
  'dong_动力火车': '当',
};

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
    
    // 预处理歌名和艺术家
    const processedTrackName = preprocessTrackName(finalTrackName);
    const processedArtists = preprocessArtists(finalArtistName);
    
    // 检查英文歌名映射
    const normalizedTrackName = processedTrackName.toLowerCase().trim();
    let searchTrackName = processedTrackName;
    let mapped = false;
    
    for (const artist of processedArtists) {
      const normalizedArtistName = artist.toLowerCase().trim();
      const exactKey = `${normalizedTrackName}_${normalizedArtistName}`;
      
      if (englishToChineseMap[exactKey]) {
        searchTrackName = englishToChineseMap[exactKey];
        mapped = true;
        console.log(`精确映射: "${finalTrackName}" -> "${searchTrackName}"`);
        break;
      }
    }
    
    console.log('实际搜索歌名:', searchTrackName);
    
    // 直接搜索
    const song = await directSearch(searchTrackName, processedArtists);
    
    if (!song) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    console.log('找到歌曲:', {
      name: getSongName(song),
      artist: extractArtists(song),
      id: song.id
    });
    
    // 获取歌词
    const lyrics = await getLyrics(song.id);
    
    // 构建响应
    const response = {
      id: song.id,
      name: getSongName(song) || finalTrackName,
      trackName: getSongName(song) || finalTrackName,
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

// 预处理艺术家
function preprocessArtists(artistName) {
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  const uniqueArtists = [...new Set(artists.filter(artist => artist.trim()))];
  console.log(`艺术家预处理: "${artistName}" ->`, uniqueArtists);
  return uniqueArtists;
}

// 预处理歌名
function preprocessTrackName(trackName) {
  const patterns = [
    / - genshin impact's.*$/i,
    / - .*anniversary.*$/i,
    / - .*theme song.*$/i,
    / - .*japanese.*$/i,
    / - .*version.*$/i,
    / - 《.*?》.*$/,
    / - .*动画.*$/,
    / - .*剧集.*$/,
    / - .*主题曲.*$/,
    /\(.*?\)/g,
    / - from the.*$/i,
    / - official.*$/i,
    / \(from.*\)/gi,
  ];
  
  let processed = trackName;
  for (const pattern of patterns) {
    processed = processed.replace(pattern, '');
  }
  
  processed = processed.replace(/\s+/g, ' ').replace(/[-\s]+$/g, '').trim();
  
  if (!processed) {
    processed = trackName.split(/[-\s–—]/)[0].trim();
  }
  
  console.log(`歌名预处理: "${trackName}" -> "${processed}"`);
  return processed;
}

// 直接搜索函数
async function directSearch(trackName, artists) {
  // 改进的长标题判断逻辑
  const shouldUseLongTitleSearch = shouldUseLongTitleStrategy(trackName);
  
  if (shouldUseLongTitleSearch) {
    console.log('检测到需要简化搜索的标题，使用简化搜索');
    return await searchLongTitle(trackName, artists);
  }
  
  // 正常搜索流程
  for (const artist of artists) {
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(trackName + ' ' + artist)}`;
    console.log('搜索URL:', searchUrl);
    
    try {
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        const match = findBestMatch(data.data, trackName, artists);
        if (match) return match;
      }
    } catch (error) {
      console.error('搜索请求失败:', error);
    }
  }
  
  return null;
}

// 判断是否应该使用长标题策略
function shouldUseLongTitleStrategy(trackName) {
  // 如果是纯英文且长度适中，不使用长标题策略
  const isEnglish = /^[a-zA-Z\s.,!?'"-]+$/.test(trackName);
  if (isEnglish && trackName.length <= 30) {
    return false;
  }
  
  // 包含明显副标题标记的使用长标题策略
  const hasSubtitleMarkers = / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version/i.test(trackName);
  if (hasSubtitleMarkers) {
    return true;
  }
  
  // 长度超过30字符的使用长标题策略
  return trackName.length > 30;
}

// 长标题搜索
async function searchLongTitle(trackName, artists) {
  const strategies = [
    // 策略1: 使用核心歌名 + 所有艺术家
    () => {
      const coreName = extractCoreName(trackName);
      console.log('策略1 - 核心歌名:', coreName);
      return artists.map(artist => `${coreName} ${artist}`);
    },
    // 策略2: 只使用日文/中文部分 + 所有艺术家
    () => {
      const japanesePart = extractJapanesePart(trackName);
      console.log('策略2 - 日文部分:', japanesePart);
      return artists.map(artist => `${japanesePart} ${artist}`);
    },
    // 策略3: 使用预处理后的歌名 + 所有艺术家
    () => {
      const processed = preprocessTrackName(trackName);
      console.log('策略3 - 预处理歌名:', processed);
      return artists.map(artist => `${processed} ${artist}`);
    },
    // 策略4: 只搜索核心歌名
    () => {
      const coreName = extractCoreName(trackName);
      console.log('策略4 - 只搜索核心歌名:', coreName);
      return [coreName];
    },
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    try {
      const keywords = strategies[i]();
      
      for (const keyword of keywords) {
        const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
        console.log(`策略${i+1} 搜索URL:`, searchUrl);
        
        const response = await axios.get(searchUrl);
        const data = response.data;
        
        if (data?.code === 200 && data.data?.length > 0) {
          const match = findBestMatch(data.data, trackName, artists);
          if (match) {
            console.log(`策略${i+1} 成功找到匹配`);
            return match;
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.warn(`策略${i+1} 失败:`, error.message);
    }
  }
  
  return null;
}

// 提取核心歌名
function extractCoreName(text) {
  // 如果是纯英文歌名，直接返回原歌名
  const isEnglish = /^[a-zA-Z\s.,!?'"-]+$/.test(text);
  if (isEnglish) {
    return text;
  }
  
  // 非英文歌名使用原有逻辑
  const japanesePart = extractJapanesePart(text);
  if (japanesePart && japanesePart !== text) return japanesePart;
  
  const processed = preprocessTrackName(text);
  if (processed && processed.length < text.length) return processed;
  
  return text.split(/[-\s–—|]/)[0] || text;
}

// 提取日文部分
function extractJapanesePart(text) {
  const japaneseMatch = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  return japaneseMatch ? japaneseMatch[0] : text.split(/[-\s]/)[0];
}

// 查找最佳匹配
function findBestMatch(results, targetTrack, artists) {
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    const score = calculateMatchScore(song, targetTrack, artists);
    const songName = getSongName(song);
    
    console.log(`检查歌曲: "${songName}" - 分数: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  // 如果没有高分数匹配，但搜索结果不为空，尝试使用精确匹配
  if (!bestMatch || bestScore < 50) {
    console.log('没有高分数匹配，尝试精确匹配');
    bestMatch = findExactMatch(results, targetTrack, artists);
  }
  
  if (bestMatch) {
    console.log(`最佳匹配: "${getSongName(bestMatch)}" - 分数: ${bestScore}`);
  } else if (results.length > 0) {
    console.log('返回第一个结果');
    bestMatch = results[0];
  }
  
  return bestMatch;
}

// 精确匹配函数 - 使用API返回的实际歌曲名进行精确匹配
function findExactMatch(results, targetTrack, artists) {
  const targetTrackLower = targetTrack.toLowerCase();
  
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    // 如果歌曲名完全匹配
    if (songName && songName.toLowerCase() === targetTrackLower) {
      console.log(`精确匹配歌曲名: "${songName}"`);
      return song;
    }
    
    // 如果歌曲名包含目标歌名
    if (songName && songName.toLowerCase().includes(targetTrackLower)) {
      console.log(`包含匹配歌曲名: "${songName}" 包含 "${targetTrack}"`);
      return song;
    }
    
    // 检查艺术家匹配
    const songArtistsLower = songArtists.toLowerCase();
    for (const artist of artists) {
      if (songArtistsLower.includes(artist.toLowerCase())) {
        console.log(`艺术家匹配: "${songArtists}" 包含 "${artist}"`);
        return song;
      }
    }
  }
  
  return null;
}

// 计算匹配分数 - 改进版，使用API返回的实际歌曲名
function calculateMatchScore(song, targetTrack, artists) {
  let score = 0;
  
  const songName = getSongName(song);
  if (!songName) return 0;
  
  const songTitle = songName.toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  
  // 标题匹配 - 使用API返回的实际歌曲名
  if (songTitle === targetTrackLower) {
    score += 100; // 完全匹配最高分
  } else if (songTitle.includes(targetTrackLower)) {
    score += 80; // 包含匹配高分
  } else if (targetTrackLower.includes(songTitle)) {
    score += 70; // 被包含匹配
  }
  
  // 艺术家匹配
  const songArtistsArray = songArtists.split(/\s*,\s*|\s+&\s+/);
  for (const targetArtist of artists) {
    const targetArtistLower = targetArtist.toLowerCase();
    for (const songArtist of songArtistsArray) {
      if (songArtist.includes(targetArtistLower) || targetArtistLower.includes(songArtist)) {
        score += 30;
        break;
      }
    }
  }
  
  return score;
}

// 获取歌曲名称 - 改进版，优先使用API返回的song字段
function getSongName(song) {
  // 优先使用 song 字段，这是API返回的实际歌曲名
  if (song.song) return song.song;
  if (song.name) return song.name;
  if (song.songname) return song.songname;
  if (song.title) return song.title;
  if (song.songName) return song.songName;
  
  // 调试信息
  console.log('歌曲数据结构:', Object.keys(song));
  return null;
}

// 提取歌手信息
function extractArtists(song) {
  if (!song.singer) return '';
  
  if (Array.isArray(song.singer)) {
    return song.singer.map(s => {
      if (typeof s === 'object') return s.name || s.title || s.singer_name || '';
      return String(s);
    }).filter(Boolean).join(', ');
  } else if (typeof song.singer === 'object') {
    return song.singer.name || song.singer.title || song.singer.singer_name || '';
  } else {
    return String(song.singer);
  }
}

// 提取专辑信息
function extractAlbumName(song) {
  if (!song.album) return '';
  if (typeof song.album === 'object') return song.album.name || song.album.title || '';
  return String(song.album);
}

// 计算时长
function calculateDuration(interval) {
  if (!interval) return 0;
  
  if (typeof interval === 'string') {
    if (interval.includes('分') && interval.includes('秒')) {
      const match = interval.match(/(\d+)分(\d+)秒/);
      if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
    } else if (interval.includes(':')) {
      const [minutes, seconds] = interval.split(':').map(Number);
      if (!isNaN(minutes) && !isNaN(seconds)) return minutes * 60 + seconds;
    } else if (!isNaN(Number(interval))) {
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