const app = getApp<IAppOption>()

Component({
  data: {},
  lifetimes: {
    attached() {},
  },
  pageLifetimes: {
    async show() {
      if (!app.globalData.loggedIn) {
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      try { await app.globalData.loginPromise } catch (e) {}
    },
  },
  methods: {},
})
