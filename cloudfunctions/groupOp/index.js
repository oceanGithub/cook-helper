const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function batchRemove(collection, where) {
  let total = 0
  while (true) {
    const res = await db.collection(collection).where(where).limit(1000).get()
    if (res.data.length === 0) break
    const ids = res.data.map(d => d._id)
    await Promise.all(ids.map(id => db.collection(collection).doc(id).remove()))
    total += ids.length
    if (res.data.length < 1000) break
  }
  return total
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, inviteCode, nickName, avatarUrl } = event

  if (action === 'join') {
    const res = await db.collection('groups').where({ inviteCode }).get()
    if (res.data.length === 0) {
      return { ok: false, err: '邀请码无效' }
    }
    const group = res.data[0]
    if (group.memberIds.includes(openid)) {
      return { ok: false, err: '已在小组中' }
    }
    await db.collection('groups').doc(group._id).update({
      data: {
        memberIds: db.command.push([openid]),
        members: db.command.push([{ openid, nickName: nickName || '', avatarUrl: avatarUrl || '' }]),
      },
    })
    return { ok: true, name: group.name }
  }

  if (action === 'leave') {
    const { groupId } = event
    if (!groupId) return { ok: false, err: '缺少小组ID' }
    const res = await db.collection('groups').doc(groupId).get()
    const group = res.data
    if (!group) return { ok: false, err: '小组不存在' }
    if (!group.memberIds.includes(openid)) {
      return { ok: false, err: '不在该小组中' }
    }
    if (group.createdBy === openid) {
      return { ok: false, err: '创建者不能退出，请删除小组' }
    }
    await db.collection('groups').doc(groupId).update({
      data: {
        memberIds: db.command.pull(openid),
        members: db.command.pull({ openid }),
      },
    })
    return { ok: true }
  }

  if (action === 'delete') {
    const { groupId } = event
    if (!groupId) return { ok: false, err: '缺少小组ID' }
    const res = await db.collection('groups').doc(groupId).get()
    const group = res.data
    if (!group) return { ok: false, err: '小组不存在' }
    if (group.createdBy !== openid) {
      return { ok: false, err: '仅创建者可删除小组' }
    }
    // 批量删除关联的分类和菜品
    await batchRemove('categories', { groupId })
    await batchRemove('dishes', { groupId })
    await db.collection('groups').doc(groupId).remove()
    return { ok: true }
  }

  return { ok: false, err: 'unknown action' }
}
