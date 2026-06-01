const app = getApp<IAppOption>()

Component({
  data: {
    userInfo: null as WechatMiniprogram.UserInfo | null,
    showLogoutDialog: false,
    showLogout: false,
  },
  lifetimes: {
    attached() {
      if (app.globalData.loggedIn) this.loadUserInfo()
    },
  },
  pageLifetimes: {
    async show() {
      if (!app.globalData.loggedIn) {
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      try { await app.globalData.loginPromise } catch (e) {}
      this.loadUserInfo()
    },
  },
  methods: {
    loadUserInfo() {
      const userInfo = app.globalData.userInfo
      const data: Record<string, any> = { showLogout: true }
      if (userInfo) data.userInfo = userInfo
      this.setData(data)
    },
    goProfile() {
      wx.navigateTo({ url: '/pages/mine/profile/profile' })
    },
    tapLogout() {
      this.setData({ showLogoutDialog: true })
    },
    confirmLogout() {
      app.globalData.loggedIn = false
      app.globalData.userInfo = undefined
      wx.removeStorageSync('currentGroupId')
      wx.removeStorageSync('wasLoggedIn')
      this.setData({ showLogoutDialog: false })
      wx.reLaunch({ url: '/pages/login/login' })
    },
    cancelLogout() {
      this.setData({ showLogoutDialog: false })
    },
    onTapComing() {
      wx.showToast({ title: '功能建设中', icon: 'none' })
    },
    goGroupManage() {
      wx.navigateTo({ url: '/pages/group/manage/manage' })
    },
  },
})
