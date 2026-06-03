Component({
  data: {
    recipeId: '',
    images: [] as string[],
    note: '',
    submitting: false,
    maxImages: 5,
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
    },
  },

  methods: {
    async chooseImage() {
      const remaining = this.data.maxImages - this.data.images.length
      if (remaining <= 0) {
        wx.showToast({ title: `最多上传${this.data.maxImages}张图片`, icon: 'none' })
        return
      }

      try {
        const res = await wx.chooseImage({
          count: remaining,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
        })

        this.setData({
          images: [...this.data.images, ...res.tempFilePaths],
        })
      } catch (e) {
        console.error('选择图片失败', e)
      }
    },

    removeImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      const images = [...this.data.images]
      images.splice(index, 1)
      this.setData({ images })
    },

    onNoteInput(e: WechatMiniprogram.Input) {
      this.setData({ note: e.detail.value })
    },

    async submit() {
      if (this.data.submitting) return
      if (this.data.images.length === 0) {
        wx.showToast({ title: '请上传至少一张成品图', icon: 'none' })
        return
      }

      this.setData({ submitting: true })

      try {
        const app = getApp<IAppOption>()
        const openid = app.globalData.openid

        // 上传图片到云存储
        const uploadedImages: string[] = []
        for (const tempPath of this.data.images) {
          const ext = tempPath.split('.').pop() || 'jpg'
          const cloudPath = `recipe-try/${openid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: tempPath,
          })
          uploadedImages.push(uploadRes.fileID)
        }

        // 调用云函数提交打卡
        await wx.cloud.callFunction({
          name: 'recipeOp',
          data: {
            action: 'try',
            id: this.data.recipeId,
            data: {
              images: uploadedImages,
              note: this.data.note,
              createdByName: app.globalData.userInfo?.nickName || '',
              createdByAvatar: app.globalData.userInfo?.avatarUrl || '',
            },
          },
        })

        wx.showToast({ title: '打卡成功', icon: 'success' })
        wx.setStorageSync('needsRefresh', true)
        setTimeout(() => {
          wx.navigateBack()
        }, 800)
      } catch (e) {
        console.error('打卡失败', e)
        wx.showToast({ title: '打卡失败，请重试', icon: 'none' })
      } finally {
        this.setData({ submitting: false })
      }
    },
  },
})
