import axios from 'axios';

// 中英文歌名映射表
const englishToChineseMap = {
  'unrequited_林宥嘉': '浪费',
  'fool_林宥嘉': '傻子',
  'who doesn\'t wanna_林宥嘉': '谁不想',
  'dong_动力火车': '当',
};

// 歌名清理模式
const trackNamePatterns = [
  / - genshin impact's.*$/i,
  / - .*anniversary.*$/i,
  / - .*theme song.*$/i,
  / - .*version.*$/i,
  / - 《.*?》.*$/,
  / - .*动画.*$/,
  / - .*主题曲.*$/,
  /\(.*?\)/g,
  / - from the.*$/i,
  / - official.*$/i,
  / \(from.*\)/gi,
  / - remastered.*$/i,
  / - .*mix.*$/i,
  /《(.*?)》/g,
  /---/g,
  /———/g,
];

export default async function handler(req, res) {
  // CORS 设置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
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
    console.log('搜索请求:', { trackName: finalTrackName, artistName: finalArtistName });
    
    // 预处理和搜索
    const processedTrackName = preprocessTrackName(finalTrackName);
    const processedArtists = preprocessArtists(finalArtistName);
    const searchTrackName = getMappedTrackName(processedTrackName, processedArtists);
    
    console.log('实际搜索:', searchTrackName);
    
    // 搜索歌曲
    const song = await searchSong(searchTrackName, processedArtists, finalTrackName, finalArtistName);
    if (!song) return res.status(404).json({ error: 'Song not found', message: '未找到匹配的歌曲' });
    
    console.log('找到歌曲:', { name: getSongName(song), artist: extractArtists(song), id: song.id });
    
    // 获取歌词并返回结果
    const lyrics = await getLyrics(song.id);
    const response = buildResponse(song, lyrics, finalTrackName);
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// 核心函数
function preprocessArtists(artistName) {
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  return [...new Set(artists.filter(artist => artist.trim()))];
}

function preprocessTrackName(trackName) {
  let processed = trackName;
  for (const pattern of trackNamePatterns) {
    processed = processed.replace(pattern, '');
  }
  processed = processed.replace(/\s+/g, ' ').replace(/[-\s]+$/g, '').trim();
  return processed || trackName.split(/[-\s–—]/)[0].trim();
}

function getMappedTrackName(trackName, artists) {
  for (const artist of artists) {
    const key = `${trackName.toLowerCase()}_${artist.toLowerCase()}`;
    if (englishToChineseMap[key]) {
      console.log(`映射: "${trackName}" -> "${englishToChineseMap[key]}"`);
      return englishToChineseMap[key];
    }
  }
  return trackName;
}

async function searchSong(trackName, artists, originalTrackName, originalArtistName) {
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  if (shouldSimplify) {
    console.log('使用简化搜索');
    return await simplifiedSearch(trackName, artists, originalTrackName, originalArtistName);
  }
  
  // 正常搜索
  for (const artist of artists) {
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(trackName + ' ' + artist)}`;
    console.log('搜索URL:', searchUrl);
    
    try {
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        const match = findBestMatch(data.data, trackName, artists, originalTrackName, originalArtistName);
        if (match) return match;
      }
    } catch (error) {
      console.error('搜索失败:', error);
    }
  }
  
  return null;
}

async function simplifiedSearch(trackName, artists, originalTrackName, originalArtistName) {
  const strategies = [
    () => artists.map(artist => `${extractCoreName(trackName)} ${artist}`),
    () => artists.map(artist => `${preprocessTrackName(trackName)} ${artist}`),
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    try {
      const keywords = strategies[i]();
      
      for (const keyword of keywords) {
        const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
        console.log(`策略${i+1} 搜索:`, searchUrl);
        
        const response = await axios.get(searchUrl);
        const data = response.data;
        
        if (data?.code === 200 && data.data?.length > 0) {
          const match = findBestMatch(data.data, trackName, artists, originalTrackName, originalArtistName);
          if (match) {
            console.log(`策略${i+1} 成功`);
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

function extractCoreName(text) {
  const isEnglish = /^[a-zA-Z\s.,!?'"-]+$/.test(text);
  if (isEnglish) {
    const processed = preprocessTrackName(text);
    return processed && processed.length < text.length ? processed : text;
  }
  
  const japanesePart = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  if (japanesePart) return japanesePart[0];
  
  const processed = preprocessTrackName(text);
  return processed && processed.length < text.length ? processed : text.split(/[-\s–—|]/)[0] || text;
}

function findBestMatch(results, targetTrack, artists, originalTrackName, originalArtistName) {
  // 先尝试精确匹配
  const exactMatch = findExactMatch(results, originalTrackName, originalArtistName);
  if (exactMatch) return exactMatch;
  
  // 智能评分匹配
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    const score = calculateSmartScore(song, targetTrack, artists, originalTrackName, originalArtistName);
    const songName = getSongName(song);
    
    console.log(`检查: "${songName}" - "${extractArtists(song)}" - 分数: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  return bestMatch || (results.length > 0 ? results[0] : null);
}

function findExactMatch(results, originalTrackName, originalArtistName) {
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    if (songName && songArtists) {
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
        console.log(`完全精确匹配: "${songName}" - "${songArtists}"`);
        return song;
      }
    }
  }
  
  return null;
}

function calculateSmartScore(song, targetTrack, artists, originalTrackName, originalArtistName) {
  const songName = getSongName(song);
  if (!songName) return 0;
  
  const songTitle = songName.toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  const originalTrackNameLower = originalTrackName.toLowerCase();
  const originalArtistNameLower = originalArtistName.toLowerCase();
  
  let titleScore = calculateTitleScore(songTitle, targetTrackLower, originalTrackNameLower);
  let artistScore = calculateArtistScore(songArtists, artists, originalArtistNameLower);
  
  // 动态权重计算
  let { titleWeight, artistWeight } = calculateWeights(titleScore, artistScore);
  let totalScore = (titleScore * titleWeight) + (artistScore * artistWeight);
  
  // 特殊情况加分
  if (songTitle === originalTrackNameLower) totalScore = Math.max(totalScore, 95);
  if (titleScore >= 70 && artistScore >= 80) totalScore += 15;
  if (artistScore === 100 && titleScore >= 40) totalScore += 10;
  
  return totalScore;
}

function calculateTitleScore(songTitle, targetTrack, originalTrackName) {
  if (songTitle === originalTrackName) return 100;
  if (songTitle === targetTrack) return 90;
  if (isCloseMatch(songTitle, originalTrackName)) return 80;
  if (isCloseMatch(songTitle, targetTrack)) return 70;
  if (songTitle.includes(originalTrackName) && originalTrackName.length > 3) return 60;
  if (originalTrackName.includes(songTitle) && songTitle.length > 3) return 50;
  if (songTitle.includes(targetTrack) && targetTrack.length > 3) return 40;
  if (targetTrack.includes(songTitle) && songTitle.length > 3) return 30;
  return 0;
}

function calculateArtistScore(songArtists, targetArtists, originalArtistName) {
  const songArtistsArray = songArtists.split(/\s*,\s*|\s+&\s+/);
  let maxScore = 0;
  
  for (const targetArtist of targetArtists) {
    const targetArtistLower = targetArtist.toLowerCase();
    
    for (const songArtist of songArtistsArray) {
      if (songArtist === originalArtistName) {
        maxScore = Math.max(maxScore, 100);
        break;
      } else if (songArtist === targetArtistLower) {
        maxScore = Math.max(maxScore, 80);
        break;
      } else if (songArtist.includes(originalArtistName) || originalArtistName.includes(songArtist)) {
        maxScore = Math.max(maxScore, 60);
        break;
      } else if (songArtist.includes(targetArtistLower) || targetArtistLower.includes(songArtist)) {
        maxScore = Math.max(maxScore, 40);
        break;
      }
    }
  }
  
  return maxScore;
}

function calculateWeights(titleScore, artistScore) {
  let titleWeight = 0.6;
  let artistWeight = 0.4;
  
  if (artistScore >= 80 && titleScore >= 40) {
    titleWeight = 0.4;
    artistWeight = 0.6;
  }
  
  if (titleScore >= 90 && artistScore >= 40) {
    titleWeight = 0.8;
    artistWeight = 0.2;
  }
  
  return { titleWeight, artistWeight };
}

function isCloseMatch(songTitle, targetTitle) {
  const cleanSong = songTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  const cleanTarget = targetTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  
  if (cleanSong === cleanTarget) return true;
  
  const hasJapaneseOrChinese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(targetTitle);
  if (hasJapaneseOrChinese) {
    const corePart = targetTitle.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/)?.[0] || targetTitle;
    if (songTitle.includes(corePart)) return true;
  }
  
  return false;
}

// 工具函数
function getSongName(song) {
  return song.song || song.name || song.songname || song.title || song.songName;
}

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

function extractAlbumName(song) {
  if (!song.album) return '';
  if (typeof song.album === 'object') return song.album.name || song.album.title || '';
  return String(song.album);
}

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

async function getLyrics(songId) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let translatedLyrics = '';
    
    if (data?.code === 200 && data.data) {
      if (data.data.lrc) {
        syncedLyrics = removeNonLyricContent(data.data.lrc);
        plainLyrics = extractPlainLyrics(syncedLyrics);
      }
      
      if (data.data.trans) {
        translatedLyrics = removeNonLyricContent(data.data.trans);
        console.log('成功获取翻译歌词');
      } else {
        console.log('未找到翻译歌词');
      }
    }
    
    return { syncedLyrics, plainLyrics, translatedLyrics };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return { syncedLyrics: '', plainLyrics: '', translatedLyrics: '' };
  }
}

function removeNonLyricContent(lyricContent) {
  if (!lyricContent) return '';
  
  return lyricContent
    .split('\n')
    .filter(line => {
      const trimmedLine = line.trim();
      
      // 过滤空行和注释行
      if (trimmedLine === '' || trimmedLine === '//') return false;
      
      // 过滤特定类型的行
      const patternsToRemove = [
        /^\[\d+:\d+(\.\d+)?\]\s*\/\/\s*$/, // [00:00.00]//
        /^\[\d+:\d+(\.\d+)?\]\s*(TME|QQ音乐)享有本翻译作品的著作权\s*$/, // 版权声明
        /^\[\d+:\d+(\.\d+)?\]\s*以下歌词翻译由文曲大模型提供\s*$/, // 文曲大模型说明
        /^\[(al|by|offset|t_time|kana|lang|total):.*\]$/, // 其他元数据标签
        /^\[\d+:\d+(\.\d+)?\]\s*$/, // 只有时间轴的空行
      ];
      
      if (patternsToRemove.some(pattern => pattern.test(trimmedLine))) {
        return false;
      }
      
      // 保留[ti]和[ar]标签以及实际的歌词行
      return /^\[(ti|ar):.*\]$/.test(trimmedLine) || 
             (/^\[\d+:\d+(\.\d+)?\]/.test(trimmedLine) && trimmedLine.length > 10) ||
             (!/^\[.*\]$/.test(trimmedLine));
    })
    .join('\n');
}

function extractPlainLyrics(lyricContent) {
  if (!lyricContent) return '';
  
  return lyricContent
    .split('\n')
    .map(line => line.replace(/\[\d+:\d+\.\d+\]|\[\d+:\d+\]|\[.*?\]/g, '').trim())
    .filter(line => line)
    .join('\n');
}

function buildResponse(song, lyrics, finalTrackName) {
  return {
    id: song.id,
    name: getSongName(song) || finalTrackName,
    trackName: getSongName(song) || finalTrackName,
    artistName: extractArtists(song),
    albumName: extractAlbumName(song),
    duration: calculateDuration(song.interval),
    instrumental: !lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '',
    plainLyrics: lyrics.plainLyrics,
    syncedLyrics: lyrics.syncedLyrics,
    translatedLyrics: lyrics.translatedLyrics
  };
}