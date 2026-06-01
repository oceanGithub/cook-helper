const db = wx.cloud.database()

export function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function dedupeDefaultGroups(): Promise<void> {
  const app = getApp<IAppOption>()
  const res = await db.collection('groups')
    .where({ memberIds: app.globalData.openid })
    .get()
  const defaults = res.data.filter((g: any) => g.type === 'default')
  if (defaults.length <= 1) return

  defaults.sort((a: any, b: any) => a._id.localeCompare(b._id))
  for (let i = 1; i < defaults.length; i++) {
    const dup = defaults[i]
    await db.collection('categories').where({ groupId: dup._id }).remove()
    await db.collection('groups').doc(dup._id).remove()
  }

  const currentGroupId = wx.getStorageSync('currentGroupId') || ''
  if (currentGroupId && defaults.slice(1).some((d: any) => d._id === currentGroupId)) {
    wx.setStorageSync('currentGroupId', defaults[0]._id)
  }
}

export async function createDefaultGroup(): Promise<string> {
  const app = getApp<IAppOption>()
  const gid = (await db.collection('groups').add({
    data: {
      name: '默认分组',
      type: 'default',
      inviteCode: genCode(),
      createdBy: app.globalData.openid,
      createdByName: app.globalData.userInfo?.nickName || '',
      memberIds: [app.globalData.openid],
      members: [{ openid: app.globalData.openid, nickName: app.globalData.userInfo?.nickName || '', avatarUrl: app.globalData.userInfo?.avatarUrl || '' }],
      createdAt: db.serverDate(),
    },
  }))._id
  wx.setStorageSync('currentGroupId', gid)
  wx.cloud.callFunction({ name: 'userSetting', data: { action: 'set', currentGroupId: gid } })
  return gid
}
