const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const ALLOWED_COLLECTIONS = ['dishes', 'categories', 'plans']

async function cleanupImages(images) {
  if (!images || images.length === 0) return
  const cloudFiles = images.filter(url => url && url.startsWith('cloud://'))
  if (cloudFiles.length === 0) return
  try {
    for (let i = 0; i < cloudFiles.length; i += 50) {
      const batch = cloudFiles.slice(i, i + 50)
      await cloud.deleteFile({ fileList: batch })
    }
  } catch (e) {
    console.error('cleanup images failed:', e)
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, collection, id, data, fileIDs } = event

  // 获取云存储文件临时URL（管理员权限）
  if (action === 'getTempFileURL') {
    if (!fileIDs || fileIDs.length === 0) return { fileList: [] }
    try {
      const result = await cloud.getTempFileURL({ fileList: fileIDs })
      return { fileList: result.fileList || [] }
    } catch (e) {
      console.error('getTempFileURL failed:', e)
      return { fileList: [], err: String(e) }
    }
  }

  if (!ALLOWED_COLLECTIONS.includes(collection)) {
    return { err: 'forbidden collection', ok: false }
  }

  if (action === 'add') {
    try { await db.createCollection(collection) } catch (e) {}
    return await db.collection(collection).add({
      data: {
        ...data,
        _openid: openid,
        createdBy: openid,
        createdAt: db.serverDate(),
      },
    })
  }

  if (action === 'update') {
    const doc = await db.collection(collection).doc(id).get()
    // categories 属于分组，任何成员可编辑；dishes 只有创建者可编辑
    if (collection !== 'categories' && doc.data.createdBy !== openid) {
      return { err: '无权编辑他人菜品', ok: false }
    }
    return await db.collection(collection).doc(id).update({
      data: {
        ...data,
        updatedAt: db.serverDate(),
      },
    })
  }

  if (action === 'remove') {
    const doc = await db.collection(collection).doc(id).get()
    // categories 属于分组，任何成员可删除；dishes 只有创建者可删除
    if (collection !== 'categories' && doc.data.createdBy !== openid) {
      return { err: '无权删除他人菜品', ok: false }
    }
    // 清理云存储中的图片
    if (collection === 'dishes') {
      const images = doc.data.images || []
      const legacyImage = doc.data.imageUrl ? [doc.data.imageUrl] : []
      await cleanupImages([...images, ...legacyImage])
    }
    return await db.collection(collection).doc(id).remove()
  }

  if (action === 'batchUpdateCreator') {
    const { createdByName, createdByAvatar } = data || {}
    const updateData = {}
    if (createdByName) updateData.createdByName = createdByName
    if (createdByAvatar) updateData.createdByAvatar = createdByAvatar
    if (Object.keys(updateData).length === 0) return { updated: 0, ok: true }
    // 只允许更新自己创建的菜品
    const count = await db.collection('dishes').where({ createdBy: openid }).update({
      data: updateData,
    })
    return { updated: count.stats.updated, ok: true }
  }

  return { err: 'unknown action', ok: false }
}
