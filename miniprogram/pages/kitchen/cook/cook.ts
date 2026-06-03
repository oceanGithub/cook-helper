Component({
  data: {
    recipeId: '',
    steps: [] as Array<{text: string, image?: string, timer?: number}>,
    currentIndex: 0,
    timerSeconds: 0,
    timerRunning: false,
    timerInterval: null as any,
    statusBarHeight: 20,
  },

  lifetimes: {
    attached() {
      const recipeId = wx.getStorageSync('detailRecipeId') || ''
      wx.removeStorageSync('detailRecipeId')
      const systemInfo = wx.getSystemInfoSync()
      this.setData({
        recipeId,
        statusBarHeight: systemInfo.statusBarHeight || 20
      })
      this.loadRecipe()
    },

    detached() {
      this.clearTimer()
    },
  },

  methods: {
    async loadRecipe() {
      try {
        const db = wx.cloud.database()
        const res = await db.collection('recipes').doc(this.data.recipeId).get()
        const recipe = res.data as any
        
        if (recipe?.steps && recipe.steps.length > 0) {
          this.setData({ steps: recipe.steps })
        } else {
          wx.showToast({ title: '菜谱步骤为空', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 800)
        }
      } catch (e) {
        console.error('加载菜谱失败', e)
        wx.showToast({ title: '加载失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
      }
    },

    prevStep() {
      if (this.data.currentIndex > 0) {
        this.clearTimer()
        this.setData({ currentIndex: this.data.currentIndex - 1, timerSeconds: 0, timerRunning: false })
      }
    },

    nextStep() {
      if (this.data.currentIndex < this.data.steps.length - 1) {
        this.clearTimer()
        this.setData({ currentIndex: this.data.currentIndex + 1, timerSeconds: 0, timerRunning: false })
      }
    },

    goBack() {
      this.clearTimer()
      wx.navigateBack()
    },

    finishCook() {
      this.clearTimer()
      wx.setStorageSync('detailRecipeId', this.data.recipeId)
      wx.redirectTo({ url: '/pages/kitchen/try/try' })
    },

    toggleTimer() {
      if (this.data.timerRunning) {
        this.pauseTimer()
      } else {
        this.startTimer()
      }
    },

    startTimer() {
      const currentStep = this.data.steps[this.data.currentIndex]
      if (!currentStep?.timer || currentStep.timer <= 0) return

      const totalSeconds = currentStep.timer
      const startTime = Date.now()
      let remainingSeconds = this.data.timerSeconds > 0 ? this.data.timerSeconds : totalSeconds

      this.setData({ timerRunning: true })

      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const currentRemaining = remainingSeconds - elapsed

        if (currentRemaining <= 0) {
          this.timerFinished()
          return
        }

        this.setData({ timerSeconds: currentRemaining })
      }, 1000)

      this.setData({ timerInterval: interval })
    },

    pauseTimer() {
      this.clearTimer()
      this.setData({ timerRunning: false })
    },

    clearTimer() {
      if (this.data.timerInterval) {
        clearInterval(this.data.timerInterval)
        this.setData({ timerInterval: null })
      }
    },

    timerFinished() {
      this.clearTimer()
      this.setData({ timerRunning: false, timerSeconds: 0 })

      // 震动提醒
      wx.vibrateLong()

      // 显示完成提示
      wx.showModal({
        title: '计时完成',
        content: '时间到了！',
        showCancel: false,
        confirmText: '知道了',
      })
    },

    formatTime(seconds: number): string {
      const mins = Math.floor(seconds / 60)
      const secs = seconds % 60
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    },
  },
})
