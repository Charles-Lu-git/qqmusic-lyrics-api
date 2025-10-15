import axios from 'axios';

export default async function handler(request, response) {
  // 设置 CORS 头
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 处理 OPTIONS 请求（预检请求）
  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  // 只允许 GET 请求
  if (request.method !== 'GET') {
    return response.status(405).json({ 
      error: 'Method Not Allowed',
      message: '只支持 GET 请求' 
    });
  }

  const { trackName, artistName } = request.query;

  console.log('收到请求参数:', { trackName, artistName });

  // 验证必要参数
  if (!trackName) {
    return response.status(400).json({
      error: "Bad Request",
      message: "trackName 参数是必需的"
    });
  }

  try {
    // 构建搜索关键词
    const searchKeyword = artistName ? `${trackName} ${artistName}` : trackName;
    console.log("搜索关键词:", searchKeyword);

    // 第一步：搜索歌曲
    const songInfo = await searchSong(searchKeyword);
    if (!songInfo) {
      return response.status(404).json({
        error: "Not Found",
        message: "未找到匹配的歌曲"
      });
    }

    console.log("找到歌曲:", songInfo);

    // 第二步：获取歌词
    const lyricData = await getLyric(songInfo.id, songInfo.mid);
    
    // 构建最终响应
    const apiResponse = {
      id: `qq_${songInfo.mid || songInfo.id}`,
      trackName: songInfo.name,
      artistName: songInfo.artists,
      albumName: songInfo.album,
      duration: songInfo.duration,
      plainLyrics: lyricData.plainLyrics || "",
      syncedLyrics: lyricData.syncedLyrics || "",
      source: "QQ音乐",
      lyricType: lyricData.lyricType || "none"
    };

    // 如果没有歌词，添加提示信息
    if (!lyricData.success) {
      apiResponse.message = lyricData.message;
    }

    console.log("返回API响应");
    response.status(200).json(apiResponse);

  } catch (error) {
    console.error("API处理错误:", error);
    response.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
}

// 搜索歌曲
async function searchSong(keyword) {
  const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
  
  try {
    console.log("搜索URL:", searchUrl);
    const response = await axios.get(searchUrl);
    const data = response.data;

    console.log("搜索API响应状态:", data.code);

    if (data && data.code === 200 && data.data && data.data.length > 0) {
      const song = data.data[0];
      
      // 处理歌手信息
      let artists = '';
      if (song.singer) {
        if (Array.isArray(song.singer)) {
          artists = song.singer.map(s => s.name || s.title || '').filter(Boolean).join(', ');
        } else if (typeof song.singer === 'object') {
          artists = song.singer.name || song.singer.title || '';
        }
      }
      
      // 处理专辑信息
      let album = '';
      if (song.album) {
        if (typeof song.album === 'object') {
          album = song.album.name || song.album.title || '';
        } else {
          album = song.album;
        }
      }

      return {
        id: song.id,
        mid: song.mid,
        name: song.name || song.songname || '',
        artists: artists,
        album: album,
        duration: song.interval ? (song.interval * 1000).toString() : '0'
      };
    }
    
    console.log("未找到歌曲或搜索失败");
    return null;
    
  } catch (error) {
    console.error("搜索歌曲失败:", error.message);
    throw new Error(`搜索失败: ${error.message}`);
  }
}

// 获取歌词
async function getLyric(songId, songMid) {
  let lyricUrl = 'https://api.vkeys.cn/v2/music/tencent/lyric?';
  
  if (songId) {
    lyricUrl += `id=${songId}`;
  } else if (songMid) {
    lyricUrl += `mid=${songMid}`;
  } else {
    return {
      success: false,
      message: "缺少歌曲ID"
    };
  }

  try {
    console.log("歌词URL:", lyricUrl);
    const response = await axios.get(lyricUrl);
    const data = response.data;

    console.log("歌词API响应状态:", data.code);

    if (data && data.code === 200 && data.data) {
      let lyricContent = '';
      let lyricType = 'none';
      
      // 优先使用逐字歌词 (YRC)
      if (data.data.yrc) {
        console.log("使用逐字歌词 (YRC)");
        lyricContent = data.data.yrc;
        lyricType = 'yrc';
        
        // 尝试Base64解码
        try {
          const decoded = Buffer.from(data.data.yrc, 'base64').toString('utf-8');
          if (isValidLyric(decoded)) {
            lyricContent = decoded;
            console.log("YRC Base64解码成功");
          }
        } catch (e) {
          console.warn('YRC Base64解码失败，使用原始内容');
        }
      } 
      // 其次使用普通歌词 (LRC)
      else if (data.data.lyric) {
        console.log("使用普通歌词 (LRC)");
        lyricContent = data.data.lyric;
        lyricType = 'lrc';
        
        // 尝试Base64解码
        try {
          const decoded = Buffer.from(data.data.lyric, 'base64').toString('utf-8');
          if (isValidLyric(decoded)) {
            lyricContent = decoded;
            console.log("LRC Base64解码成功");
          }
        } catch (e) {
          console.warn('LRC Base64解码失败，使用原始内容');
        }
      } else {
        return {
          success: false,
          message: "未找到歌词"
        };
      }
      
      return {
        success: true,
        syncedLyrics: lyricContent,
        plainLyrics: extractPlainLyrics(lyricContent),
        lyricType: lyricType
      };
    }
    
    return {
      success: false,
      message: data ? data.msg : "获取歌词失败"
    };
    
  } catch (error) {
    console.error("获取歌词失败:", error.message);
    return {
      success: false,
      message: `获取歌词失败: ${error.message}`
    };
  }
}

// 检查是否是有效的歌词内容
function isValidLyric(content) {
  if (!content || content.length < 10) return false;
  
  // 检查是否包含常见的时间标签或文字内容
  const patterns = [
    /\[\d+:\d+\.\d+\]/, // LRC时间标签
    /<\d+\.\d+\.\d+>/,  // YRC时间标签
    /[\u4e00-\u9fff]/,  // 中文字符
    /[a-zA-Z]/,         // 英文字母
  ];
  
  return patterns.some(pattern => pattern.test(content));
}

// 提取纯文本歌词
function extractPlainLyrics(lyricContent) {
  if (!lyricContent) return '';
  
  return lyricContent
    .replace(/\[\d+:\d+\.\d+\]/g, '')  // 移除 LRC 时间标签
    .replace(/<\d+\.\d+\.\d+>/g, '')   // 移除 YRC 时间标签
    .replace(/\(\d+,\d+\)/g, '')       // 移除其他时间格式
    .replace(/\s+/g, ' ')              // 合并多个空格
    .trim();
}
