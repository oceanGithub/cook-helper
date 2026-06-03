const app = getApp<IAppOption>()
const db = wx.cloud.database()
const _ = db.command

interface Dish {
  _id: string
  name: string
  categoryId: string
  rating: number
  address: string
  imageUrl?: string
  images?: string[]
  note: string
  createdBy: string
  createdByName: string
  createdAt?: string
}

interface Recipe {
  _id: string
  dishName: string
  difficulty: number
  prepTime: number
  cookTime: number
  coverImage?: string
  likeCount: number
  tryCount: number
  createdByName: string
  createdByAvatar?: string
}

Component({
  data: {
    dishId: '',
    dish: null as Dish | null,
    images: [] as string[],
    openid: '',
    loading: false,
    showDeleteDialog: false,
    deleting: false,
    currentImageIndex: 0,
    pageReady: false,
    detailFrom: '',
    planDate: '',
    mealType: '',
    partners: [] as { nickName: string; avatarUrl: string }[],
    relatedRecipes: [] as Recipe[],
  },

  lifetimes: {
    attached() {
      const dishId = wx.getStorageSync('detailDishId') || ''
      const detailFrom = wx.getStorageSync('detailFrom') || ''
      const planDate = wx.getStorageSync('detailPlanDate') || ''
      const mealType = wx.getStorageSync('detailMealType') || ''
      if (dishId) {
        wx.removeStorageSync('detailDishId')
        wx.removeStorageSync('detailFrom')
        wx.removeStorageSync('detailPlanDate')
        wx.removeStorageSync('detailMealType')
        this.setData({ dishId, openid: app.globalData.openid, detailFrom, planDate, mealType })
        this.loadDish()
      }
    },
  },

  methods: {
    async loadDish() {
      this.setData({ loading: true })
      try {
        const doc = await db.collection('dishes').doc(this.data.dishId).get()
        const d = doc.data as Dish | undefined
        if (!d) {
          wx.showToast({ title: '菜品不存在', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 800)
          return
        }
        let images = d.images?.length ? d.images : (d.imageUrl ? [d.imageUrl] : [])
        // cloud:// 图片转为可访问的临时 HTTPS URL（通过云函数）
        const cloudFiles = images.filter((img: string) => img && img.startsWith('cloud://'))
        if (cloudFiles.length > 0) {
          try {
            const imgRes = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIds: cloudFiles } })
            const urlMap = (imgRes.result as any)?.urlMap || {}
            images = images.map((img: string) => urlMap[img] || img)
          } catch (e) { console.error('获取图片URL失败', e) }
        }
        this.setData({ dish: d, images, currentImageIndex: 0, pageReady: false })
        setTimeout(() => this.setData({ pageReady: true }), 300)
        this.resolveCreatorName(d)
        this.loadRelatedRecipes()
        if (this.data.detailFrom === 'calendar') {
          this.loadPartners()
        }
      } catch (e) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },

    async loadRelatedRecipes() {
      try {
        const res = await db.collection('recipes')
          .where({ dishId: this.data.dishId })
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get()

        const recipes = (res.data || []) as Recipe[]
        this.setData({ relatedRecipes: recipes })
      } catch (e) {
        console.error('加载相关菜谱失败', e)
      }
    },

    async resolveCreatorName(dish: Dish) {
      if (!dish.createdBy) return
      try {
        const res = await wx.cloud.callFunction({ name: 'getMemberInfos', data: { openids: [dish.createdBy] } })
        const info = (res.result as any)?.list?.[0]
        if (!info) return
        const updates: any = {}
        const dbUpdate: any = {}
        if (info.nickName && info.nickName !== '匿名' && info.nickName !== dish.createdByName) {
          updates['dish.createdByName'] = info.nickName
          dbUpdate.createdByName = info.nickName
        }
        if (info.avatarUrl && info.avatarUrl !== dish.createdByAvatar) {
          updates['dish.createdByAvatar'] = info.avatarUrl
          dbUpdate.createdByAvatar = info.avatarUrl
        }
        if (Object.keys(updates).length > 0) {
          this.setData(updates)
          db.collection('dishes').doc(dish._id).update({ data: dbUpdate })
        }
      } catch (e) { }
    },

    onSwiperChange(e: WechatMiniprogram.SwiperChange) {
      this.setData({ currentImageIndex: e.detail.current })
    },

    previewImage(e: any) {
      const idx = e.currentTarget.dataset.index
      wx.previewImage({
        current: this.data.images[idx],
        urls: this.data.images,
      })
    },

    goToRecipeDetail(e: WechatMiniprogram.TouchEvent) {
      const recipeId = e.currentTarget.dataset.id
      wx.setStorageSync('detailRecipeId', recipeId)
      wx.navigateTo({ url: '/pages/kitchen/detail/detail' })
    },

    async loadPartners() {
      const gid = wx.getStorageSync('currentGroupId') || ''
      const planDate = this.data.planDate
      if (!gid || !planDate) return
      try {
        const planRes = await db.collection('plans')
          .where({ groupId: gid, date: planDate, dishId: this.data.dishId })
          .get()
        const plans = (planRes.data || []) as any[]
        const allPartnerIds: string[] = []
        for (const p of plans) {
          if (p.partnerIds?.length) {
            allPartnerIds.push(...p.partnerIds)
          }
        }
        if (allPartnerIds.length === 0) return
        const uniqueIds = [...new Set(allPartnerIds)]
        // 从 groups.members 中解析搭档信息
        const groupRes = await db.collection('groups').doc(gid).get()
        const members = (groupRes.data as any)?.members || []
        const fallbackMap: Record<string, { nickName: string; avatarUrl: string }> = {}
        for (const m of members) {
          fallbackMap[m.openid] = { nickName: m.nickName, avatarUrl: m.avatarUrl }
        }
        // 云函数统一查询（头像转为可访问的 HTTPS URL）
        const res = await wx.cloud.callFunction({ name: 'getMemberInfos', data: { openids: uniqueIds } })
        const infos = (res.result as any)?.list || []
        for (const info of infos) {
          fallbackMap[info.openid] = { nickName: info.nickName || fallbackMap[info.openid]?.nickName || '', avatarUrl: info.avatarUrl || fallbackMap[info.openid]?.avatarUrl || '' }
        }
        const partners = uniqueIds
          .map(id => fallbackMap[id] || { nickName: '', avatarUrl: '' })
          .filter(p => p.nickName)
        // 将搭档头像 cloud:// 转为 HTTPS URL
        const avatarFileIds = partners.filter((p: any) => p.avatarUrl && p.avatarUrl.startsWith('cloud://')).map((p: any) => p.avatarUrl)
        if (avatarFileIds.length > 0) {
          try {
            const imgRes = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIds: avatarFileIds } })
            const urlMap = (imgRes.result as any)?.urlMap || {}
            for (const p of partners) {
              if (urlMap[p.avatarUrl]) p.avatarUrl = urlMap[p.avatarUrl]
            }
          } catch (e) { console.error('获取搭档头像URL失败', e) }
        }
        this.setData({ partners })
      } catch (e) {
        console.error('加载搭档失败', e)
      }
    },

    goEdit() {
      const dish = this.data.dish
      if (!dish) return
      wx.setStorageSync('editDishId', dish._id)
      wx.setStorageSync('needsRefresh', true)
      wx.navigateTo({ url: '/pages/dish/edit/edit' })
    },

    openDelete() {
      this.setData({ showDeleteDialog: true, deleting: false })
    },

    async confirmDelete() {
      if (this.data.deleting) return
      this.setData({ deleting: true })
      try {
        await wx.cloud.callFunction({
          name: 'dishOp',
          data: { action: 'remove', collection: 'dishes', id: this.data.dishId },
        })
        wx.setStorageSync('needsRefresh', true)
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 800)
      } catch (e) {
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ showDeleteDialog: false, deleting: false })
      }
    },

    closeDeleteDialog() {
      this.setData({ showDeleteDialog: false, deleting: false })
    },

    copyAddress() {
      if (!this.data.dish?.address) return
      wx.setClipboardData({ data: this.data.dish.address })
    },

    goBack() {
      wx.navigateBack()
    },
  },
})
