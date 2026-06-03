const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function cleanupImages(images) {
  if (!images || images.length === 0) return
  const cloudFiles = images.filter(function(url) { return url && url.startsWith('cloud://') })
  if (cloudFiles.length === 0) return
  try {
    for (var i = 0; i < cloudFiles.length; i += 50) {
      var batch = cloudFiles.slice(i, i + 50)
      await cloud.deleteFile({ fileList: batch })
    }
  } catch (e) {
    console.error('cleanup images failed:', e)
  }
}

exports.main = async function(event, context) {
  var wxContext = cloud.getWXContext()
  var openid = wxContext.OPENID
  var action = event.action
  var data = event.data || {}
  var id = event.id

  // === CRUD ===
  if (action === 'add') {
    try { await db.createCollection('recipes') } catch (e) {}
    return await db.collection('recipes').add({
      data: Object.assign({}, data, {
        _openid: openid,
        createdBy: openid,
        createdAt: db.serverDate(),
        likeCount: 0,
        tryCount: 0
      })
    })
  }

  if (action === 'update') {
    var doc = await db.collection('recipes').doc(id).get()
    if (doc.data.createdBy !== openid) return { err: 'no permission', ok: false }
    return await db.collection('recipes').doc(id).update({
      data: Object.assign({}, data, { updatedAt: db.serverDate() })
    })
  }

  if (action === 'remove') {
    var doc2 = await db.collection('recipes').doc(id).get()
    if (doc2.data.createdBy !== openid) return { err: 'no permission', ok: false }
    var allImages = []
    if (doc2.data.steps) {
      doc2.data.steps.forEach(function(s) { if (s.image) allImages.push(s.image) })
    }
    await cleanupImages(allImages)
    await db.collection('recipeLikes').where({ recipeId: id }).remove()
    await db.collection('recipeComments').where({ recipeId: id }).remove()
    await db.collection('recipeTries').where({ recipeId: id }).remove()
    await db.collection('recipeBookmarks').where({ recipeId: id }).remove()
    return await db.collection('recipes').doc(id).remove()
  }

  // === LIKE ===
  if (action === 'like') {
    try { await db.createCollection('recipeLikes') } catch (e) {}
    var existing = await db.collection('recipeLikes').where({ _openid: openid, recipeId: id }).get()
    if (existing.data.length > 0) return { ok: true, liked: true }
    await db.collection('recipeLikes').add({
      data: { _openid: openid, recipeId: id, createdAt: db.serverDate() }
    })
    await db.collection('recipes').doc(id).update({ data: { likeCount: _.inc(1) } })
    return { ok: true, liked: true }
  }

  if (action === 'unlike') {
    var res = await db.collection('recipeLikes').where({ _openid: openid, recipeId: id }).remove()
    if (res.stats.removed > 0) {
      await db.collection('recipes').doc(id).update({ data: { likeCount: _.inc(-1) } })
    }
    return { ok: true, liked: false }
  }

  // === BOOKMARK ===
  if (action === 'bookmark') {
    try { await db.createCollection('recipeBookmarks') } catch (e) {}
    var ex = await db.collection('recipeBookmarks').where({ _openid: openid, recipeId: id }).get()
    if (ex.data.length > 0) return { ok: true, bookmarked: true }
    await db.collection('recipeBookmarks').add({
      data: { _openid: openid, recipeId: id, createdAt: db.serverDate() }
    })
    return { ok: true, bookmarked: true }
  }

  if (action === 'unbookmark') {
    await db.collection('recipeBookmarks').where({ _openid: openid, recipeId: id }).remove()
    return { ok: true, bookmarked: false }
  }

  // === COMMENT ===
  if (action === 'comment') {
    try { await db.createCollection('recipeComments') } catch (e) {}
    return await db.collection('recipeComments').add({
      data: {
        _openid: openid,
        recipeId: id,
        content: data.content || '',
        createdByName: data.createdByName || '',
        createdByAvatar: data.createdByAvatar || '',
        createdAt: db.serverDate()
      }
    })
  }

  // === TRY (打卡) ===
  if (action === 'try') {
    try { await db.createCollection('recipeTries') } catch (e) {}
    await db.collection('recipeTries').add({
      data: {
        _openid: openid,
        recipeId: id,
        images: data.images || [],
        note: data.note || '',
        createdByName: data.createdByName || '',
        createdByAvatar: data.createdByAvatar || '',
        createdAt: db.serverDate()
      }
    })
    await db.collection('recipes').doc(id).update({ data: { tryCount: _.inc(1) } })
    return { ok: true }
  }

  // === DELETE COMMENT ===
  if (action === 'deleteComment') {
    var commentId = data.commentId
    if (!commentId) return { err: 'missing commentId', ok: false }
    var commentDoc = await db.collection('recipeComments').doc(commentId).get()
    if (commentDoc.data._openid !== openid) return { err: 'no permission', ok: false }
    return await db.collection('recipeComments').doc(commentId).remove()
  }

  // === DELETE TRY ===
  if (action === 'deleteTry') {
    var tryId = data.tryId
    if (!tryId) return { err: 'missing tryId', ok: false }
    var tryDoc = await db.collection('recipeTries').doc(tryId).get()
    if (tryDoc.data._openid !== openid) return { err: 'no permission', ok: false }
    // 清理打卡图片
    await cleanupImages(tryDoc.data.images)
    // 减少打卡数
    await db.collection('recipes').doc(tryDoc.data.recipeId).update({ data: { tryCount: _.inc(-1) } })
    return await db.collection('recipeTries').doc(tryId).remove()
  }

  // === QUERY HELPERS ===
  if (action === 'checkStatus') {
    var liked = await db.collection('recipeLikes').where({ _openid: openid, recipeId: id }).count()
    var bookmarked = await db.collection('recipeBookmarks').where({ _openid: openid, recipeId: id }).count()
    var tried = await db.collection('recipeTries').where({ _openid: openid, recipeId: id }).count()
    return {
      liked: liked.total > 0,
      bookmarked: bookmarked.total > 0,
      tried: tried.total > 0
    }
  }

  return { err: 'unknown action', ok: false }
}
