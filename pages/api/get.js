import axios from 'axios';

// 中英文歌名映射表 - 包含艺术家信息避免混淆
const englishToChineseMap = {
  // 林宥嘉
  'unrequited_林宥嘉': '浪费',
  'fool_林宥嘉': '傻子',
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
    
    // 预处理歌名 - 移除副标题和说明
    const processedTrackName = preprocessTrackName(finalTrackName);
    console.log('预处理后歌名:', processedTrackName);
    
    // 预处理艺术家 - 处理多艺术家情况
    const processedArtists = preprocessArtists(finalArtistName);
    console.log('预处理后艺术家:', processedArtists);
    
    // 检查英文歌名映射（包含艺术家信息）
    const normalizedTrackName = processedTrackName.toLowerCase().trim();
    
    let searchTrackName = processedTrackName;
    let mapped = false;
    
    // 对每个艺术家尝试映射
    for (const artist of processedArtists) {
      const normalizedArtistName = artist.toLowerCase().trim();
      
      // 先尝试精确匹配：歌名_艺术家
      const exactKey = `${normalizedTrackName}_${normalizedArtistName}`;
      console.log('尝试精确匹配键:', exactKey);
      
      if (englishToChineseMap[exactKey]) {
        searchTrackName = englishToChineseMap[exactKey];
        mapped = true;
        console.log(`精确映射: "${finalTrackName}" + "${artist}" -> "${searchTrackName}"`);
        break;
      } else {
        // 尝试部分匹配：检查所有可能的组合
        for (const [key, chineseName] of Object.entries(englishToChineseMap)) {
          const [engName, engArtist] = key.split('_');
          
          // 如果歌名匹配且艺术家部分匹配
          if (engName === normalizedTrackName && 
              (normalizedArtistName.includes(engArtist) || engArtist.includes(normalizedArtistName))) {
            searchTrackName = chineseName;
            mapped = true;
            console.log(`部分匹配映射: "${finalTrackName}" + "${artist}" -> "${searchTrackName}"`);
            break;
          }
        }
      }
      if (mapped) break;
    }
    
    if (!mapped) {
      console.log('未找到映射，使用预处理歌名搜索');
    }
    
    console.log('实际搜索歌名:', searchTrackName);
    
    // 使用所有艺术家进行搜索
    const song = await directSearch(searchTrackName, processedArtists);
    
    if (!song) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    console.log('找到歌曲详情:', song);
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

// 预处理艺术家 - 处理多艺术家情况
function preprocessArtists(artistName) {
  // 分割多艺术家（支持逗号、&、和等分隔符）
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  
  // 过滤空值并去重
  const uniqueArtists = [...new Set(artists.filter(artist => artist.trim()))];
  
  console.log(`艺术家预处理: "${artistName}" ->`, uniqueArtists);
  return uniqueArtists;
}

// 预处理歌名 - 移除副标题和说明
function preprocessTrackName(trackName) {
  // 移除常见的副标题和说明
  const patterns = [
    // 中文模式
    / - 《.*?》.*$/,
    / - .*动画.*$/,
    / - .*剧集.*$/,
    / - .*主题曲.*$/,
    / - .*插曲.*$/,
    / - .*片尾曲.*$/,
    / - .*片头曲.*$/,
    /（.*?）/g,
    /\(.*?\)/g,
    
    // 英文模式
    / - from the.*$/i,
    / - official.*$/i,
    / - theme.*$/i,
    / - soundtrack.*$/i,
    / - original.*$/i,
    / - music.*$/i,
    / - song.*$/i,
    / - .*version.*$/i,
    / - .*edit.*$/i,
    / - .*mix.*$/i,
    / \(from.*\)/gi,
    / \(official.*\)/gi,
    / \(.*arcane.*\)/gi,
    / \(.*league of legends.*\)/gi,
  ];
  
  let processed = trackName;
  
  for (const pattern of patterns) {
    processed = processed.replace(pattern, '');
  }
  
  // 清理多余空格和特殊字符
  processed = processed
    .replace(/\s+/g, ' ')
    .replace(/[-\s]+$/g, '')
    .trim();
  
  console.log(`歌名预处理: "${trackName}" -> "${processed}"`);
  
  return processed;
}

// 直接搜索函数 - 专注于解决问题
async function directSearch(trackName, artists) {
  // 针对长标题的特殊处理
  if (trackName.length > 10) {
    console.log('检测到长标题，使用简化搜索');
    return await searchLongTitle(trackName, artists);
  }
  
  // 使用所有艺术家进行搜索
  const searchKeywords = [];
  for (const artist of artists) {
    searchKeywords.push(`${trackName} ${artist}`);
  }
  
  // 尝试每个艺术家的组合
  for (const keyword of searchKeywords) {
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
    console.log('搜索URL:', searchUrl);
    
    try {
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      console.log('搜索响应状态:', data?.code);
      console.log('搜索结果数量:', data?.data?.length);
      
      if (data?.code === 200 && data.data?.length > 0) {
        // 打印前几个结果的详细信息用于调试
        data.data.slice(0, 3).forEach((song, index) => {
          console.log(`结果 ${index + 1}:`, {
            name: getSongName(song),
            artist: extractArtists(song),
            id: song.id
          });
        });
        
        const match = findBestMatch(data.data, trackName, artists);
        if (match) {
          return match;
        }
      }
    } catch (error) {
      console.error('搜索请求失败:', error);
    }
  }
  
  return null;
}

// 专门处理长标题的搜索
async function searchLongTitle(trackName, artists) {
  console.log('原始标题长度:', trackName.length);
  console.log('原始标题:', trackName);
  
  // 尝试不同的搜索策略
  const strategies = [
    // 策略1: 使用预处理后的歌名 + 所有艺术家
    () => {
      const processed = preprocessTrackName(trackName);
      console.log('策略1 - 预处理歌名:', processed);
      const keywords = artists.map(artist => `${processed} ${artist}`);
      return keywords;
    },
    // 策略2: 只使用核心歌名 + 所有艺术家
    () => {
      const coreName = extractCoreName(trackName);
      console.log('策略2 - 核心歌名:', coreName);
      const keywords = artists.map(artist => `${coreName} ${artist}`);
      return keywords;
    },
    // 策略3: 只搜索主要艺术家
    () => {
      console.log('策略3 - 只搜索主要艺术家:', artists[0]);
      return [`${trackName} ${artists[0]}`];
    },
    // 策略4: 只搜索艺术家
    () => {
      console.log('策略4 - 只搜索艺术家');
      return artists;
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
      
      // 短暂延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.warn(`策略${i+1} 失败:`, error.message);
      continue;
    }
  }
  
  return null;
}

// 提取核心歌名
function extractCoreName(text) {
  // 首先尝试预处理
  const processed = preprocessTrackName(text);
  if (processed.length < text.length) {
    return processed;
  }
  
  // 提取第一个有意义的部分
  const parts = text.split(/[-\s–—|]/);
  return parts[0] || text;
}

// 查找最佳匹配
function findBestMatch(results, targetTrack, artists) {
  console.log(`在 ${results.length} 个结果中查找最佳匹配`);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    const score = calculateMatchScore(song, targetTrack, artists);
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    console.log(`检查歌曲: "${songName}" - 艺术家: "${songArtists}" - 分数: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  if (bestMatch) {
    console.log(`最佳匹配: "${getSongName(bestMatch)}" - 艺术家: "${extractArtists(bestMatch)}" - 分数: ${bestScore}`);
  } else if (results.length > 0) {
    console.log('没有高分数匹配，返回第一个结果');
    bestMatch = results[0];
  }
  
  return bestMatch;
}

// 计算匹配分数 - 支持多艺术家
function calculateMatchScore(song, targetTrack, artists) {
  let score = 0;
  
  const songTitle = (getSongName(song) || '').toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  
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
  
  // 艺术家匹配 - 改进多艺术家处理
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

// 获取歌曲名称 - 修复 undefined 问题
function getSongName(song) {
  // 尝试多种可能的字段名
  if (song.name) return song.name;
  if (song.songname) return song.songname;
  if (song.title) return song.title;
  if (song.songName) return song.songName;
  
  return null;
}

// 提取歌手信息 - 改进多艺术家处理
function extractArtists(song) {
  if (!song.singer) return '';
  
  if (Array.isArray(song.singer)) {
    return song.singer.map(s => {
      if (typeof s === 'object') {
        return s.name || s.title || s.singer_name || '';
      }
      return String(s);
    }).filter(Boolean).join(', ');
  } else if (typeof song.singer === 'object') {
    return song.singer.name || song.singer.title || song.singer.singer_name || '';
  } else {
    return String(song.singer);
  }
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
  return text.split(/\s+/)[0];
}

// 提取关键词
function extractKeywords(text) {
  // 移除常见修饰词
  const modifiers = [
    'Genshin Impact\'s', 'Anniversary', 'Japanese', 'Theme', 'Song',
    '原神', '周年', '主题曲', '日文版', 'Arcane', 'League of Legends'
  ];
  
  let result = text;
  modifiers.forEach(mod => {
    result = result.replace(new RegExp(mod, 'gi'), '');
  });
  
  // 清理多余空格和特殊字符
  return result.replace(/\s+/g, ' ').replace(/[^\w\u4e00-\u9fff\s]/g, '').trim();
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