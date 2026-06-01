Component({
  data: {
    statusBarHeight: 20,
  },

  lifetimes: {
    attached() {
      const { statusBarHeight } = wx.getSystemInfoSync()
      this.setData({ statusBarHeight })
    },
  },
})
