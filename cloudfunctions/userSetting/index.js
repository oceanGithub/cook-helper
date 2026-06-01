const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, reminderEnabled, currentGroupId } = event

  if (action === 'get') {
    try {
      const res = await db.collection('userSettings').where({ _openid: OPENID }).get()
      return { ok: true, data: res.data[0] || null }
    } catch (e) {
      if (e.errCode === -502005) return { ok: true, data: null }
      throw e
    }
  }

  if (action === 'set') {
    const data = {}
    if (reminderEnabled !== undefined) data.reminderEnabled = reminderEnabled
    if (currentGroupId !== undefined) data.currentGroupId = currentGroupId
    try {
      const res = await db.collection('userSettings').where({ _openid: OPENID }).update({ data })
      if (res.stats.updated === 0) {
        try {
          await db.collection('userSettings').add({ data: { _openid: OPENID, ...data } })
        } catch (e2) {
          if (e2.errCode === -502005) {
            await db.createCollection('userSettings')
            await db.collection('userSettings').add({ data: { _openid: OPENID, ...data } })
          } else {
            throw e2
          }
        }
      }
      return { ok: true }
    } catch (e) {
      if (e.errCode === -502005) {
        await db.createCollection('userSettings')
        await db.collection('userSettings').add({ data: { _openid: OPENID, ...data } })
        return { ok: true }
      }
      throw e
    }
  }

  return { ok: false, err: 'unknown action' }
}
