interface SpotDetail {
  _id: string
  name: string
  city: string
  district: string
  address: string
  latitude: number
  longitude: number
  travelMethod: string
  travelNote: string
  playType: string
  playTypeNote: string
  coverImage: string
  images: string[]
  note: string
  rating: number
  createdBy: string
  createdByName: string
  createdByAvatar: string
  createdAt: string
}

const playTypeMap: Record<string, string> = {
  'eat-play': '吃喝玩乐',
  'camping': '露营',
  'picnic': '野餐',
  'hiking': '徒步',
  'climbing': '爬山',
  'other': '其他',
}

const travelMethodMap: Record<string, string> = {
  'self-drive': '自驾',
  'other': '其他',
}

Component({
  data: {
    spot: null as SpotDetail | null,
    isOwner: false,
    playTypeLabel: '',
    travelMethodLabel: '',
    coverImageUrl: '',
    imageUrls: [] as string[],
    loading: true,
  },

  lifetimes: {
    attached() {
      const spotId = wx.getStorageSync('spotDetailId')
      if (spotId) {
        wx.removeStorageSync('spotDetailId')
        this.loadDetail(spotId)
      }
    },
  },

  pageLifetimes: {
    show() {
      if (wx.getStorageSync('needsRefresh')) {
        wx.removeStorageSync('needsRefresh')
        // 重新加载详情
        if (this.data.spot?._id) {
          this.loadDetail(this.data.spot._id)
        }
      }
    },
  },

  methods: {
    async loadDetail(id: string) {
      try {
        const db = wx.cloud.database()
        const res = await db.collection('leisureSpots').doc(id).get()
        const spot = res.data as SpotDetail

        // 检查是否为创建者（兼容 createdBy 和 _openid）
        const { openid } = await wx.cloud.callFunction({ name: 'login' }).then(r => r.result as { openid: string })
        const isOwner = spot.createdBy === openid || (spot as any)._openid === openid

        // 获取图片临时URL
        let coverImageUrl = ''
        let imageUrls: string[] = []
        let createdByAvatarUrl = spot.createdByAvatar || ''

        // 收集需要转换的云存储文件ID（cloud:// 开头）
        const fileIDs: string[] = []
        if (spot.coverImage && spot.coverImage.startsWith('cloud://')) fileIDs.push(spot.coverImage)
        if (spot.images && spot.images.length > 0) {
          fileIDs.push(...spot.images.filter(id => id.startsWith('cloud://')))
        }
        if (spot.createdByAvatar && spot.createdByAvatar.startsWith('cloud://')) {
          fileIDs.push(spot.createdByAvatar)
        }

        // 批量获取临时URL
        if (fileIDs.length > 0) {
          const tempRes = await wx.cloud.getTempFileURL({ fileList: fileIDs })
          const urlMap: Record<string, string> = {}
          tempRes.fileList.forEach((f: any) => {
            if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL
          })

          if (spot.coverImage && urlMap[spot.coverImage]) {
            coverImageUrl = urlMap[spot.coverImage]
          }
          if (spot.images && spot.images.length > 0) {
            imageUrls = spot.images.map(id => urlMap[id] || id)
          }
          if (spot.createdByAvatar && urlMap[spot.createdByAvatar]) {
            createdByAvatarUrl = urlMap[spot.createdByAvatar]
          }
        }

        this.setData({
          spot: { ...spot, createdByAvatarUrl },
          isOwner,
          playTypeLabel: playTypeMap[spot.playType] || spot.playType,
          travelMethodLabel: travelMethodMap[spot.travelMethod] || spot.travelMethod,
          coverImageUrl,
          imageUrls,
          loading: false,
        })

        // 设置地图标记
        if (spot.latitude && spot.longitude) {
          this.setData({
            markers: [{
              id: 1,
              latitude: spot.latitude,
              longitude: spot.longitude,
              title: spot.name,
            }],
          })
        }
      } catch (err) {
        console.error('加载详情失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },

    // 预览封面图
    previewCoverImage() {
      if (this.data.coverImageUrl) {
        wx.previewImage({ urls: [this.data.coverImageUrl] })
      }
    },

    // 预览游玩图片
    previewImage(e: WechatMiniprogram.TouchEvent) {
      const index = e.currentTarget.dataset.index
      wx.previewImage({
        urls: this.data.imageUrls,
        current: this.data.imageUrls[index],
      })
    },

    // 导航到目的地
    openNavigation() {
      const { spot } = this.data
      if (!spot) return
      wx.openLocation({
        latitude: spot.latitude,
        longitude: spot.longitude,
        name: spot.name,
        address: spot.address,
      })
    },

    // 编辑
    goEdit() {
      if (!this.data.spot) return
      wx.setStorageSync('editSpotId', this.data.spot._id)
      wx.navigateTo({ url: '/pages/leisure/spot-edit/spot-edit' })
    },

    // 删除
    deleteSpot() {
      wx.showModal({
        title: '确认删除',
        content: '确定要删除这个好去处吗？删除后无法恢复',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm && this.data.spot) {
            wx.showLoading({ title: '删除中...' })
            try {
              const db = wx.cloud.database()
              await db.collection('leisureSpots').doc(this.data.spot._id).remove()

              // 删除图片
              const fileIDs: string[] = []
              if (this.data.spot.coverImage) fileIDs.push(this.data.spot.coverImage)
              if (this.data.spot.images) fileIDs.push(...this.data.spot.images)
              if (fileIDs.length > 0) {
                await wx.cloud.deleteFile({ fileList: fileIDs })
              }

              wx.hideLoading()
              wx.showToast({ title: '已删除', icon: 'success' })
              wx.setStorageSync('needsRefresh', true)
              setTimeout(() => wx.navigateBack(), 800)
            } catch (err) {
              console.error('删除失败:', err)
              wx.hideLoading()
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          }
        },
      })
    },
  },
})
