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
    
    // 1. 搜索歌曲
    const searchKeyword = `${finalTrackName} ${finalArtistName}`;
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
      } else {
        artists = String(song.singer);
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
    
    // 处理时长转换 - 专门处理中文格式 "4分29秒"
    let duration = 0;
    
    if (song.interval) {
      console.log('原始 interval 值:', song.interval, '类型:', typeof song.interval);
      
      if (typeof song.interval === 'string') {
        // 处理中文格式 "4分29秒"
        if (song.interval.includes('分') && song.interval.includes('秒')) {
          const match = song.interval.match(/(\d+)分(\d+)秒/);
          if (match && match.length === 3) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            duration = minutes * 60 + seconds;
            console.log(`解析中文时长: ${minutes}分${seconds}秒 -> ${duration}秒`);
          } else {
            console.warn('无法解析中文时长格式:', song.interval);
          }
        } 
        // 处理数字格式 "4:29"
        else if (song.interval.includes(':')) {
          const timeParts = song.interval.split(':');
          if (timeParts.length === 2) {
            const minutes = parseInt(timeParts[0], 10);
            const seconds = parseInt(timeParts[1], 10);
            if (!isNaN(minutes) && !isNaN(seconds)) {
              duration = minutes * 60 + seconds;
            }
          }
        }
        // 处理纯数字字符串
        else if (!isNaN(Number(song.interval))) {
          duration = Number(song.interval);
        }
      } else if (typeof song.interval === 'number') {
        // 如果已经是数字，直接使用
        duration = song.interval;
      }
    } else {
      console.warn('歌曲对象中未找到 interval 字段');
    }
    
    console.log('最终计算得到的 duration (秒):', duration);
    
    // 2. 获取歌词 - 使用 id 而不是 mid
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${song.id}`;
    console.log('歌词URL:', lyricUrl);
    
    const lyricResponse = await axios.get(lyricUrl);
    const lyricData = lyricResponse.data;
    
    console.log('歌词API完整响应:', JSON.stringify(lyricData, null, 2));
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let translatedLyrics = '';
    let lyricType = 'none';
    
    if (lyricData && lyricData.code === 200 && lyricData.data) {
      // 专门提取lrc字段 - 原始歌词
      if (lyricData.data.lrc) {
        console.log("找到LRC歌词字段");
        lyricType = 'lrc';
        syncedLyrics = lyricData.data.lrc;
        
        console.log(`LRC歌词长度:`, syncedLyrics.length);
        console.log(`LRC歌词预览:`, syncedLyrics.substring(0, 200));
        
        // 从LRC歌词中提取纯文本，保留换行结构
        plainLyrics = extractPlainLyrics(syncedLyrics);
        
        // 确保同步歌词以换行符结尾
        if (syncedLyrics && !syncedLyrics.endsWith('\n')) {
          syncedLyrics += '\n';
        }
      }
      
      // 提取翻译歌词
      if (lyricData.data.tlrc) {
        console.log("找到翻译歌词字段");
        translatedLyrics = lyricData.data.tlrc;
        console.log(`翻译歌词长度:`, translatedLyrics.length);
        console.log(`翻译歌词预览:`, translatedLyrics.substring(0, 200));
      } else if (lyricData.data.klyric) {
        console.log("找到KLYRIC歌词字段");
        translatedLyrics = lyricData.data.klyric;
        console.log(`KLYRIC歌词长度:`, translatedLyrics.length);
        console.log(`KLYRIC歌词预览:`, translatedLyrics.substring(0, 200));
      } else {
        console.log("未找到翻译歌词字段，可用字段:", Object.keys(lyricData.data));
      }
    } else {
      console.log('歌词API返回错误:', lyricData ? lyricData.msg : '未知错误');
    }
    
    // 判断是否为纯音乐
    const instrumental = !syncedLyrics || syncedLyrics.trim() === '';
    
    // 构建响应
    const response = {
      id: song.id,
      name: song.name || song.songname || finalTrackName,
      trackName: song.name || song.songname || finalTrackName,
      artistName: artists,
      albumName: albumName,
      duration: duration,
      instrumental: instrumental,
      plainLyrics: plainLyrics,
      syncedLyrics: syncedLyrics,
      translatedLyrics: translatedLyrics,
      translationLanguage: translatedLyrics ? detectTranslationLanguage(translatedLyrics) : null
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

// 检测翻译歌词的语言
function detectTranslationLanguage(lyrics) {
  if (!lyrics) return null;
  
  const koreanRegex = /[가-힣]/;
  const japaneseRegex = /[ぁ-んァ-ン一-龯]/;
  const chineseRegex = /[一-龯]/;
  
  if (koreanRegex.test(lyrics)) return 'ko';
  if (japaneseRegex.test(lyrics)) return 'ja';
  if (chineseRegex.test(lyrics)) return 'zh';
  
  return 'en';
}
