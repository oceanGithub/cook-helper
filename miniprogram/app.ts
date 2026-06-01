// app.ts
App<IAppOption>({
  globalData: {
    openid: '',
    loggedIn: false,
  },
  onLaunch() {
    // 同步读取缓存的登录态，在页面渲染前决定是否已登录
    this.globalData.loggedIn = !!wx.getStorageSync('wasLoggedIn')

    wx.cloud.init({
      env: 'cloud1-d2gr067wp3692f858',
    })

    const db = wx.cloud.database()

    this.globalData.loginPromise = wx.cloud.callFunction({
      name: 'login',
    }).then(async res => {
      const { openid } = res.result as { openid: string }
      this.globalData.openid = openid

      try {
        const userRes = await db.collection('users').where({
          _openid: openid,
        }).orderBy('createdAt', 'desc').limit(1).get()
        if (userRes.data.length > 0) {
          this.globalData.userInfo = userRes.data[0].userInfo
        }
      } catch (e) {
        console.error('查询用户记录失败', e)
      }

      // 从云端恢复上次选中的分组
      try {
        const settingRes = await wx.cloud.callFunction({ name: 'userSetting', data: { action: 'get' } })
        const setting = (settingRes.result as any)?.data
        if (setting?.currentGroupId && !wx.getStorageSync('currentGroupId')) {
          wx.setStorageSync('currentGroupId', setting.currentGroupId)
        }
      } catch (e) {
        console.error('恢复分组设置失败', e)
      }

      return openid
    }).catch(e => {
      console.error('获取 openid 失败', e)
      return ''
    })
  },
})