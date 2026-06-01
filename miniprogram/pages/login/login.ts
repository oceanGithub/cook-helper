const app = getApp<IAppOption>()
const defaultAvatarUrl =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

const db = wx.cloud.database()

Component({
  data: {
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: '',
    },
    hasUserInfo: false,
    loading: false,
    avatarError: false,
    canIUseNicknameComp: wx.canIUse('input.type.nickname'),
  },
  lifetimes: {
    attached() {
      this.checkLogin()
    },
  },
  pageLifetimes: {
    show() {
      this.checkLogin()
    },
  },
  methods: {
    async checkLogin() {
      if (app.globalData.loggedIn) {
        wx.reLaunch({ url: '/pages/index/index' })
        return
      }
      // 未登录：等待 openid 就绪后展示登录表单
      try { await app.globalData.loginPromise } catch (e) {}
    },

    onChooseAvatar(e: any) {
      const { avatarUrl } = e.detail
      const { nickName } = this.data.userInfo
      this.setData({
        'userInfo.avatarUrl': avatarUrl,
        avatarError: false,
        hasUserInfo: !!(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl),
      })
    },

    onAvatarError() {
      this.setData({ avatarError: true })
    },

    onInputChange(e: any) {
      const nickName = e.detail.value
      const { avatarUrl } = this.data.userInfo
      this.setData({
        'userInfo.nickName': nickName,
        hasUserInfo: !!(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl),
      })
    },

    async onConfirmLogin() {
      if (!this.data.hasUserInfo || this.data.loading) return

      this.setData({ loading: true })

      try {
        // 上传头像到云存储获取永久链接
        let avatarUrl = this.data.userInfo.avatarUrl
        if (avatarUrl && avatarUrl !== defaultAvatarUrl) {
          const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: avatarUrl,
          })
          avatarUrl = uploadRes.fileID
        }

        const userInfo: WechatMiniprogram.UserInfo = {
          nickName: this.data.userInfo.nickName,
          avatarUrl,
          gender: 0,
          country: '',
          province: '',
          city: '',
          language: 'zh_CN',
        }

        // 已有记录则更新，避免重复创建
        const existRes = await db.collection('users').where({ _openid: app.globalData.openid }).get()
        if (existRes.data.length > 0) {
          await db.collection('users').doc(existRes.data[0]._id).update({ data: { userInfo } })
        } else {
          await db.collection('users').add({
            data: {
              userInfo,
              createdAt: db.serverDate(),
            },
          })
        }

        app.globalData.userInfo = userInfo
        app.globalData.loggedIn = true
        wx.setStorageSync('wasLoggedIn', true)
        wx.reLaunch({ url: '/pages/index/index' })
      } catch (e) {
        console.error('保存用户失败', e)
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },
  },
})
