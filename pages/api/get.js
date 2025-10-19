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
  
  // 支持两种参数格式
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
    console.log('收到请求:', { finalTrackName, finalArtistName });
    
    // 智能搜索策略
    const searchResults = await smartSearch(finalTrackName, finalArtistName);
    
    if (!searchResults || searchResults.length === 0) {
      return res.status(404).json({
        error: 'Song not found',
        message: '未找到匹配的歌曲'
      });
    }
    
    // 使用最佳匹配结果
    const song = searchResults[0];
    console.log('最终选择的歌曲:', song);
    
    // 提取歌手信息
    let artists = extractArtists(song);
    
    // 提取专辑信息
    let albumName = extractAlbumName(song);
    
    // 处理时长转换
    let duration = calculateDuration(song.interval);
    console.log('最终计算得到的 duration (秒):', duration);
    
    // 获取歌词
    const { syncedLyrics, plainLyrics, lyricType } = await getLyrics(song.id);
    
    // 判断是否为纯音乐
    const instrumental = !syncedLyrics || syncedLyrics.trim() === '';
    
    // 构建与 Lrclib 完全兼容的响应格式
    const response = {
      id: song.id,
      name: song.name || song.songname || finalTrackName,
      trackName: song.name || song.songname || finalTrackName,
      artistName: artists,
      albumName: albumName,
      duration: duration,
      instrumental: instrumental,
      plainLyrics: plainLyrics,
      syncedLyrics: syncedLyrics
    };
    
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

// 智能搜索策略
async function smartSearch(trackName, artistName) {
  // 生成多种搜索策略
  const searchStrategies = generateSearchStrategies(trackName, artistName);
  
  console.log('生成的搜索策略:', searchStrategies);

  for (const strategy of searchStrategies) {
    try {
      const searchKeyword = strategy.keyword;
      console.log(`尝试搜索策略 [${strategy.type}]: ${searchKeyword}`);
      
      const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(searchKeyword)}`;
      console.log('搜索URL:', searchUrl);
      
      const searchResponse = await axios.get(searchUrl);
      const searchData = searchResponse.data;
      
      if (searchData && searchData.code === 200 && searchData.data && searchData.data.length > 0) {
        // 过滤和排序结果
        const filteredResults = filterAndSortResults(searchData.data, trackName, artistName, strategy.type);
        
        if (filteredResults.length > 0) {
          console.log(`策略 [${strategy.type}] 成功，找到 ${filteredResults.length} 个结果`);
          return filteredResults;
        } else {
          console.log(`策略 [${strategy.type}] 找到结果但匹配度不高`);
        }
      } else {
        console.log(`策略 [${strategy.type}] 未找到结果`);
      }
      
      // 等待一下再尝试下一个策略，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.warn(`搜索策略失败 [${strategy.type}]:`, error.message);
      continue;
    }
  }
  
  return null;
}

// 生成多种搜索策略
function generateSearchStrategies(trackName, artistName) {
  const strategies = [];
  
  // 清理和预处理输入
  const cleanTrackName = cleanChineseText(trackName);
  const cleanArtistName = cleanChineseText(artistName);
  
  console.log('清理后的参数:', { cleanTrackName, cleanArtistName });
  
  // 策略1: 只搜索清理后的歌曲名（最高优先级）
  if (cleanTrackName) {
    strategies.push({
      type: 'clean_track_only',
      keyword: cleanTrackName
    });
  }
  
  // 策略2: 清理后的歌曲名 + 艺术家
  if (cleanTrackName && cleanArtistName) {
    strategies.push({
      type: 'clean_track_artist',
      keyword: `${cleanTrackName} ${cleanArtistName}`
    });
  }
  
  // 策略3: 原始歌曲名（清理特殊字符）
  const safeTrackName = removeSpecialCharacters(trackName);
  if (safeTrackName && safeTrackName !== cleanTrackName) {
    strategies.push({
      type: 'safe_track_only',
      keyword: safeTrackName
    });
  }
  
  // 策略4: 原始歌曲名 + 艺术家
  if (safeTrackName && cleanArtistName) {
    strategies.push({
      type: 'safe_track_artist',
      keyword: `${safeTrackName} ${cleanArtistName}`
    });
  }
  
  // 策略5: 提取核心中文部分
  const coreChinese = extractCoreChinese(trackName);
  if (coreChinese && coreChinese !== cleanTrackName) {
    strategies.push({
      type: 'core_chinese_only',
      keyword: coreChinese
    });
  }
  
  // 策略6: 核心中文 + 艺术家
  if (coreChinese && cleanArtistName) {
    strategies.push({
      type: 'core_chinese_artist',
      keyword: `${coreChinese} ${cleanArtistName}`
    });
  }
  
  // 策略7: 只搜索艺术家（最后的手段）
  if (cleanArtistName) {
    strategies.push({
      type: 'artist_only',
      keyword: cleanArtistName
    });
  }
  
  return strategies;
}

// 清理中文字符串
function cleanChineseText(text) {
  if (!text) return '';
  
  return text
    .replace(/[《》【】]/g, '') // 移除中文括号
    .replace(/[-—–—]/g, ' ') // 统一各种横线为空格
    .replace(/\s+/g, ' ') // 合并多个空格
    .replace(/^[^a-zA-Z0-9\u4e00-\u9fff]*|[^a-zA-Z0-9\u4e00-\u9fff]*$/g, '') // 移除首尾非中英文数字字符
    .trim();
}

// 移除特殊字符但保留中文
function removeSpecialCharacters(text) {
  if (!text) return '';
  
  return text
    .replace(/[^\w\u4e00-\u9fff\s\-]/g, '') // 只保留字母、数字、中文、空格、横线
    .replace(/\s+/g, ' ')
    .trim();
}

// 提取核心中文部分
function extractCoreChinese(text) {
  if (!text) return '';
  
  // 匹配中文字符（包括繁体）
  const chineseMatch = text.match(/[\u4e00-\u9fff]+/g);
  if (chineseMatch) {
    return chineseMatch.join(' ');
  }
  
  return '';
}

// 过滤和排序搜索结果
function filterAndSortResults(results, targetTrackName, targetArtistName, strategyType) {
  const cleanTargetTrack = cleanChineseText(targetTrackName).toLowerCase();
  const cleanTargetArtist = cleanChineseText(targetArtistName).toLowerCase();
  
  console.log(`过滤条件: track="${cleanTargetTrack}", artist="${cleanTargetArtist}"`);
  
  return results
    .map(song => {
      // 计算匹配分数
      let score = 0;
      
      // 提取歌曲信息
      const songTitle = (song.name || song.songname || '').toLowerCase();
      const songArtists = extractArtists(song).toLowerCase();
      const cleanSongTitle = cleanChineseText(songTitle).toLowerCase();
      
      console.log(`检查歌曲: "${songTitle}" - 艺术家: "${songArtists}"`);
      
      // 标题匹配度（最高权重）
      if (cleanSongTitle === cleanTargetTrack) {
        score += 100; // 完全匹配
        console.log(`  → 标题完全匹配 +100`);
      } else if (cleanSongTitle.includes(cleanTargetTrack)) {
        score += 80; // 包含目标
        console.log(`  → 标题包含目标 +80`);
      } else if (cleanTargetTrack.includes(cleanSongTitle)) {
        score += 60; // 被目标包含
        console.log(`  → 目标包含标题 +60`);
      } else {
        // 检查中文核心匹配
        const targetCore = extractCoreChinese(targetTrackName).toLowerCase();
        const songCore = extractCoreChinese(songTitle).toLowerCase();
        if (targetCore && songCore && targetCore === songCore) {
          score += 90;
          console.log(`  → 中文核心匹配 +90`);
        } else if (targetCore && songCore && songCore.includes(targetCore)) {
          score += 70;
          console.log(`  → 中文核心包含 +70`);
        }
      }
      
      // 艺术家匹配度
      if (songArtists.includes(cleanTargetArtist)) {
        score += 50;
        console.log(`  → 艺术家匹配 +50`);
      } else if (cleanTargetArtist.includes(songArtists)) {
        score += 30;
        console.log(`  → 艺术家部分匹配 +30`);
      }
      
      // 根据搜索策略调整权重
      if (strategyType.includes('clean') || strategyType.includes('core')) {
        score += 5; // 清理策略的额外权重
      }
      
      // 时长合理性
      const duration = calculateDuration(song.interval);
      if (duration > 60 && duration < 600) {
        score += 5;
      }
      
      console.log(`  → 最终分数: ${score}`);
      
      return { song, score };
    })
    .filter(item => item.score > 20) // 只保留有一定匹配度的结果
    .sort((a, b) => b.score - a.score) // 按分数降序排列
    .map(item => item.song);
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
  let duration = 0;
  
  if (!interval) {
    console.warn('歌曲对象中未找到 interval 字段');
    return duration;
  }
  
  console.log('原始 interval 值:', interval, '类型:', typeof interval);
  
  if (typeof interval === 'string') {
    // 处理中文格式 "4分29秒"
    if (interval.includes('分') && interval.includes('秒')) {
      const match = interval.match(/(\d+)分(\d+)秒/);
      if (match && match.length === 3) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        duration = minutes * 60 + seconds;
        console.log(`解析中文时长: ${minutes}分${seconds}秒 -> ${duration}秒`);
      } else {
        console.warn('无法解析中文时长格式:', interval);
      }
    } 
    // 处理数字格式 "4:29"
    else if (interval.includes(':')) {
      const timeParts = interval.split(':');
      if (timeParts.length === 2) {
        const minutes = parseInt(timeParts[0], 10);
        const seconds = parseInt(timeParts[1], 10);
        if (!isNaN(minutes) && !isNaN(seconds)) {
          duration = minutes * 60 + seconds;
        }
      }
    }
    // 处理纯数字字符串
    else if (!isNaN(Number(interval))) {
      duration = Number(interval);
    }
  } else if (typeof interval === 'number') {
    duration = interval;
  }
  
  return duration;
}

// 获取歌词
async function getLyrics(songId) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`;
    console.log('歌词URL:', lyricUrl);
    
    const lyricResponse = await axios.get(lyricUrl);
    const lyricData = lyricResponse.data;
    
    console.log('歌词API完整响应:', JSON.stringify(lyricData, null, 2));
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let lyricType = 'none';
    
    if (lyricData && lyricData.code === 200 && lyricData.data) {
      if (lyricData.data.lrc) {
        console.log("找到LRC歌词字段");
        lyricType = 'lrc';
        syncedLyrics = lyricData.data.lrc;
        
        console.log(`LRC歌词长度:`, syncedLyrics.length);
        console.log(`LRC歌词预览:`, syncedLyrics.substring(0, 200));
        
        plainLyrics = extractPlainLyrics(syncedLyrics);
        
        // 处理歌词结束时间标签
        syncedLyrics = processLyricEndTime(syncedLyrics);
      } else {
        console.log("未找到lrc字段，可用字段:", Object.keys(lyricData.data));
      }
    } else {
      console.log('歌词API返回错误:', lyricData ? lyricData.msg : '未知错误');
    }
    
    return { syncedLyrics, plainLyrics, lyricType };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return { syncedLyrics: '', plainLyrics: '', lyricType: 'none' };
  }
}

// 处理歌词结束时间
function processLyricEndTime(lyricContent) {
  if (!lyricContent) return lyricContent;
  
  const lines = lyricContent.split('\n');
  
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1].trim();
    // 如果最后一行是歌词行而不是空时间标签，我们需要添加一个
    if (lastLine && !lastLine.match(/^\[\d+:\d+\.\d+\]\s*$/)) {
      console.log('检测到歌词缺少结束时间标签，尝试添加...');
      // 尝试从最后一行提取时间
      const timeMatch = lastLine.match(/\[(\d+):(\d+\.\d+)\]/);
      if (timeMatch) {
        const minutes = parseInt(timeMatch[1]);
        const seconds = parseFloat(timeMatch[2]);
        // 添加一个稍后的时间作为结束标记（例如+3秒）
        const endMinutes = minutes;
        const endSeconds = seconds + 3;
        const endTimeTag = `[${endMinutes}:${endSeconds.toFixed(2)}]`;
        return lyricContent + `\n${endTimeTag}`;
      }
    }
  }
  
  return lyricContent;
}

// 从LRC歌词中提取纯文本，保留换行结构
function extractPlainLyrics(lyricContent) {
  if (!lyricContent) return '';
  
  const lines = lyricContent.split('\n');
  const plainLines = [];
  
  for (const line of lines) {
    let plainLine = line
      .replace(/\[\d+:\d+\.\d+\]/g, '')
      .replace(/\[\d+:\d+\]/g, '')
      .replace(/\[ti:.*?\]/g, '')
      .replace(/\[ar:.*?\]/g, '')
      .replace(/\[al:.*?\]/g, '')
      .replace(/\[by:.*?\]/g, '')
      .replace(/\[offset:.*?\]/g, '')
      .replace(/\[.*?\]/g, '')
      .trim();
    
    if (plainLine) {
      plainLines.push(plainLine);
    }
  }
  
  return plainLines.join('\n');
}
