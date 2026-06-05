const app = getApp<IAppOption>()

Component({
  data: {
    statusBarHeight: 20,
    pageReady: false,
    features: [
      {
        id: 'random-dish',
        icon: '🎲',
        title: '今天吃什么？',
        desc: '不知道吃什么？让命运来决定！从你的菜品中随机抽取一道',
        tag: '热门',
        available: true,
      },
      {
        id: 'random-place',
        icon: '🎡',
        title: '休闲好去处',
        desc: '收集城市里那些值得去的好地方，逛公园、探小店、找乐趣，给生活加点料',
        tag: '热门',
        available: true,
      },
      {
        id: 'coming-soon-1',
        icon: '🎯',
        title: '口味挑战',
        desc: '挑战你的味蕾极限，尝试从未做过的菜品',
        tag: '即将上线',
        available: false,
      },
      {
        id: 'coming-soon-2',
        icon: '🏆',
        title: '厨艺打卡',
        desc: '记录你的厨艺成长之路，看看你的进步',
        tag: '即将上线',
        available: false,
      },
    ],
  },
  lifetimes: {
    attached() {
      const systemInfo = wx.getSystemInfoSync()
      this.setData({
        statusBarHeight: systemInfo.statusBarHeight || 20,
      })
    },
  },
  pageLifetimes: {
    async show() {
      if (!app.globalData.loggedIn) {
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      try { await app.globalData.loginPromise } catch (e) {}
      // 重置页面状态，触发动画重新播放
      this.setData({ pageReady: false })
      setTimeout(() => {
        this.setData({ pageReady: true })
      }, 80)
    },
  },
  methods: {
    onFeatureTap(e: WechatMiniprogram.TouchEvent) {
      const { id, available } = e.currentTarget.dataset
      if (!available) {
        wx.showToast({ title: '功能即将上线，敬请期待', icon: 'none' })
        return
      }
      switch (id) {
        case 'random-dish':
          wx.navigateTo({ url: '/pages/leisure/random-dish/random-dish' })
          break
        case 'random-place':
          wx.navigateTo({ url: '/pages/leisure/random-place/random-place' })
          break
        default:
          break
      }
    },
  },
})
