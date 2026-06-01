const app = getApp<IAppOption>()
const db = wx.cloud.database()

Component({
  data: {
    avatarUrl: '',
    nickName: '',
    saving: false,
    loading: true,
    userDocId: '',
    originalAvatarUrl: '',
    originalNickName: '',
  },

  lifetimes: {
    attached() {
      this.loadProfile()
    },
  },

  methods: {
    async loadProfile() {
      try {
        await app.globalData.loginPromise
        const openid = app.globalData.openid
        const res = await db.collection('users').where({ _openid: openid }).get()
        if (res.data.length > 0) {
          const userDoc = res.data[0]
          const info = userDoc.userInfo || {}
          this.setData({
            userDocId: userDoc._id,
            avatarUrl: info.avatarUrl || '',
            nickName: info.nickName || '',
            originalAvatarUrl: info.avatarUrl || '',
            originalNickName: info.nickName || '',
            loading: false,
          })
        } else {
          this.setData({ loading: false })
        }
      } catch (e) {
        console.error('加载资料失败', e)
        this.setData({ loading: false })
      }
    },

    onChooseAvatar(e: any) {
      this.setData({ avatarUrl: e.detail.avatarUrl })
    },

    onNickNameChange(e: any) {
      this.setData({ nickName: e.detail.value })
    },

    async save() {
      const { nickName, avatarUrl, saving, userDocId, originalAvatarUrl, originalNickName } = this.data
      if (saving) return

      const trimName = nickName.trim()
      if (!trimName) {
        wx.showToast({ title: '请输入昵称', icon: 'none' })
        return
      }

      this.setData({ saving: true })
      try {
        let finalAvatarUrl = avatarUrl

        // 头像有变化且是本地文件，上传到云存储
        if (avatarUrl && avatarUrl !== originalAvatarUrl && !avatarUrl.startsWith('cloud://')) {
          const ext = avatarUrl.split('.').pop() || 'png'
          const cloudPath = 'avatars/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl })
          finalAvatarUrl = uploadRes.fileID
        }

        const userInfo = {
          avatarUrl: finalAvatarUrl,
          nickName: trimName,
          gender: 0,
          country: '',
          province: '',
          city: '',
          language: 'zh_CN',
        }

        if (userDocId) {
          await db.collection('users').doc(userDocId).update({ data: { userInfo } })
        }

        // 同步到 globalData
        app.globalData.userInfo = userInfo as any

        // 同步更新所有小组的 members 缓存
        try {
          const openid = app.globalData.openid
          const groupsRes = await db.collection('groups').where({ memberIds: openid }).get()
          for (const group of groupsRes.data) {
            const members = group.members || []
            const idx = members.findIndex((m: any) => m.openid === openid)
            if (idx >= 0) {
              members[idx] = { ...members[idx], nickName: trimName, avatarUrl: finalAvatarUrl }
              await db.collection('groups').doc(group._id).update({ data: { members } })
            }
          }
        } catch (e) {
          console.error('同步小组成员信息失败', e)
        }

        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 800)
      } catch (e) {
        console.error('保存失败', e)
        wx.showToast({ title: '保存失败', icon: 'none' })
      } finally {
        this.setData({ saving: false })
      }
    },

    goBack() {
      wx.navigateBack()
    },
  },
})
