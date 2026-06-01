const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { openids } = event
  if (!openids || !openids.length) return { list: [] }

  try {
    const userRes = await db.collection('users').where({
      _openid: _.in(openids),
    }).get()

    const userMap = {}
    for (const u of userRes.data) {
      userMap[u._openid] = u
    }

    const list = openids.map(oid => {
      const u = userMap[oid]
      const info = u ? (u.userInfo || {}) : {}
      return {
        openid: oid,
        nickName: info.nickName || '',
        avatarUrl: info.avatarUrl || '',
      }
    })

    // 将 cloud:// fileID 转换为临时 HTTPS URL
    const cloudFiles = list
      .filter(item => item.avatarUrl && item.avatarUrl.startsWith('cloud://'))
      .map(item => item.avatarUrl)
    if (cloudFiles.length > 0) {
      const urlRes = await cloud.getTempFileURL({ fileList: cloudFiles })
      const urlMap = {}
      for (const f of urlRes.fileList) {
        urlMap[f.fileID] = f.tempFileURL || f.fileID
      }
      for (const item of list) {
        if (urlMap[item.avatarUrl]) {
          item.avatarUrl = urlMap[item.avatarUrl]
        }
      }
    }

    return { list }
  } catch (e) {
    console.error('getMemberInfos error:', e)
    return { list: [] }
  }
}
