const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, id, data } = event

  try {
    await db.createCollection('leisureSpots')
  } catch (e) {}

  // 新增
  if (action === 'add') {
    return await db.collection('leisureSpots').add({
      data: {
        ...data,
        _openid: openid,
        createdBy: openid,
        createdAt: db.serverDate(),
      },
    })
  }

  // 更新
  if (action === 'update') {
    const doc = await db.collection('leisureSpots').doc(id).get()
    if (doc.data.createdBy !== openid) {
      return { err: 'no permission', ok: false }
    }
    return await db.collection('leisureSpots').doc(id).update({
      data: { ...data, updatedAt: db.serverDate() },
    })
  }

  // 删除
  if (action === 'remove') {
    const doc = await db.collection('leisureSpots').doc(id).get()
    if (doc.data.createdBy !== openid) {
      return { err: 'no permission', ok: false }
    }

    // 删除关联图片
    const fileIDs = []
    if (doc.data.coverImage) fileIDs.push(doc.data.coverImage)
    if (doc.data.images && doc.data.images.length > 0) fileIDs.push(...doc.data.images)

    if (fileIDs.length > 0) {
      // 分批删除（每次最多50个）
      for (let i = 0; i < fileIDs.length; i += 50) {
        const batch = fileIDs.slice(i, i + 50)
        await cloud.deleteFile({ fileList: batch })
      }
    }

    return await db.collection('leisureSpots').doc(id).remove()
  }

  // 获取详情
  if (action === 'get') {
    return await db.collection('leisureSpots').doc(id).get()
  }

  // 获取列表（支持分页和筛选）
  if (action === 'list') {
    const { city, district, page = 0, pageSize = 20 } = data
    const where = {}
    if (city) where.city = city
    if (district) where.district = district

    const countRes = await db.collection('leisureSpots').where(where).count()
    const res = await db.collection('leisureSpots')
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    return {
      data: res.data,
      total: countRes.total,
      page,
      pageSize,
    }
  }

  // 获取图片临时URL
  if (action === 'getTempFileURL') {
    const { fileIDs } = data
    if (!fileIDs || fileIDs.length === 0) return { fileList: [] }
    const res = await cloud.getTempFileURL({ fileList: fileIDs })
    return res
  }

  return { err: 'unknown action', ok: false }
}
