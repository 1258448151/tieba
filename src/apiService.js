/**
 * 百度贴吧API服务
 * 包含与百度贴吧API通信的核心功能
 */
const axios = require('axios');
const { toQueryString, generateDeviceId } = require('./utils');

// 辅助函数：延时等待
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 全局配置
const MAX_RETRIES = 3;           // 最大重试次数
const RETRY_DELAY = 3000;        // 重试延迟(ms)
const RETRY_MULTIPLIER = 2;      // 重试延迟倍数

/**
 * 带重试机制的请求函数
 * @param {Function} requestFn - 请求函数
 * @param {string} operationName - 操作名称
 * @param {number} maxRetries - 最大重试次数
 * @param {number} initialDelay - 初始延迟(ms)
 * @param {number} delayMultiplier - 延迟倍数
 * @returns {Promise<any>} 请求结果
 */
async function withRetry(requestFn, operationName, maxRetries = MAX_RETRIES, initialDelay = RETRY_DELAY, delayMultiplier = RETRY_MULTIPLIER) {
  let retries = 0;
  let delay = initialDelay;
  
  while (true) {
    try {
      return await requestFn();
    } catch (error) {
      retries++;
      
      // 429错误特殊处理
      const isRateLimited = error.response && error.response.status === 429;
      
      if (retries > maxRetries || (!isRateLimited && error.response && error.response.status >= 400 && error.response.status < 500)) {
        console.error(`❌ ${operationName}失败(尝试 ${retries}次): ${error.message}`);
        throw error;
      }
      
      // 计算下次重试延迟
      if (isRateLimited) {
        // 限流时使用更长的延迟
        delay = delay * delayMultiplier * 2;
        console.warn(`⏳ 请求被限流，将在 ${delay}ms 后重试 (${retries}/${maxRetries})...`);
      } else {
        delay = delay * delayMultiplier;
        console.warn(`⏳ ${operationName}失败，将在 ${delay}ms 后重试 (${retries}/${maxRetries})...`);
      }
      
      await sleep(delay);
    }
  }
}

/**
 * 验证BDUSS是否有效并获取用户信息
 * @param {string} bduss - 百度BDUSS
 * @returns {Promise<Object>} 用户信息
 */
async function login(bduss) {
  return withRetry(async () => {
    // 通过获取用户同步信息来验证BDUSS是否有效
    const url = 'https://tieba.baidu.com/mo/q/sync';
    const headers = {
      'Cookie': `BDUSS=${bduss}`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'Connection': 'keep-alive',
      'Host': 'tieba.baidu.com',
      'Referer': 'https://tieba.baidu.com/home/main',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'
    };
    
    const response = await axios.get(url, {
      headers: headers
    });
    
    if (!response.data || response.data.no !== 0 || response.data.error !== 'success') {
      throw new Error('验证BDUSS失败，可能已过期');
    }
    
    const userId = response.data.data.user_id;
    
    const userInfo = {
      bduss: bduss,
      userId: userId,
      isValid: true,
      deviceId: generateDeviceId()
    };
    
    console.log('🔐 验证BDUSS成功');
    return userInfo;
  }, '验证BDUSS');
}

/**
 * 获取用户关注的贴吧列表及TBS
 * @param {string} bduss - 百度BDUSS
 * @returns {Promise<Object>} 贴吧列表和TBS
 */
async function getTiebaList(bduss) {
  return withRetry(async () => {
    const url = 'https://tieba.baidu.com/mo/q/newmoindex';
    const headers = {
      'Cookie': `BDUSS=${bduss}`,
      'Content-Type': 'application/octet-stream',
      'Referer': 'https://tieba.baidu.com/index/tbwise/forum',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'
    };
    
    const response = await axios.get(url, {
      headers: headers
    });
    
    if (!response.data || response.data.error !== 'success') {
      throw new Error(`获取贴吧列表失败: ${response.data?.error_msg || '未知错误'}`);
    }
    
    // 获取TBS和贴吧列表
    const tbs = response.data.data.tbs;
    const tiebaList = response.data.data.like_forum || [];
    
    console.log(`🔍 获取贴吧列表成功, 共 ${tiebaList.length} 个贴吧`);
    
    return tiebaList;
  }, '获取贴吧列表');
}

/**
 * 获取TBS参数
 * @param {string} bduss - 百度BDUSS
 * @returns {Promise<string>} tbs参数
 */
async function getTbs(bduss) {
  return withRetry(async () => {
    const url = 'http://tieba.baidu.com/dc/common/tbs';
    const headers = {
      'Cookie': `BDUSS=${bduss}`,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'
    };
    
    const response = await axios.get(url, {
      headers: headers
    });
    
    if (!response.data || !response.data.tbs) {
      throw new Error('获取tbs失败');
    }
    
    return response.data.tbs;
  }, '获取TBS参数');
}

/**
 * 签到单个贴吧
 * @param {string} bduss - 百度BDUSS
 * @param {string} tiebaName - 贴吧名称
 * @param {string} tbs - 签到所需的tbs参数
 * @param {number} index - 贴吧索引号
 * @returns {Promise<Object>} 签到结果
 */
async function signTieba(bduss, tiebaName, tbs, index) {
  return withRetry(async () => {
    const url = 'https://tieba.baidu.com/sign/add';
    const headers = {
      'Cookie': `BDUSS=${bduss}`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Encoding': 'gzip,deflate,br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Connection': 'keep-alive',
      'Host': 'tieba.baidu.com',
      'Referer': 'https://tieba.baidu.com/',
      'x-requested-with': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.135 Safari/537.36 Edg/84.0.522.63'
    };
    
    const data = {
      tbs: tbs,
      kw: tiebaName,
      ie: 'utf-8'
    };
    
    const response = await axios.post(url, toQueryString(data), {
      headers: headers
    });
    
    if (!response.data) {
      throw new Error('签到响应数据为空');
    }
    
    return response.data;
  }, `签到操作`);
}

module.exports = {
  login,
  getTiebaList,
  signTieba,
  getTbs
}; 