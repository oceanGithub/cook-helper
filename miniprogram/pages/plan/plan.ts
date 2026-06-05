const app = getApp<IAppOption>()
const db = wx.cloud.database()
const _ = db.command

const PAGE_SIZE = 5

interface Recipe {
  _id: string
  dishId: string
  dishName: string
  difficulty: number
  prepTime: number
  cookTime: number
  servings: number
  coverImage: string
  likeCount: number
  tryCount: number
  createdByName: string
  createdByAvatar: string
  createdBy: string
  createdAt: any
}

Component({
  data: {
    statusBarHeight: 20,
    searchBarTop: 20,
    topBarHeight: 0,
    recipes: [] as Recipe[],
    loading: false,
    loadingMore: false,
    noMore: false,
    refreshing: false,
    page: 0,
    hasLoadedMore: false,
    searchKey: '',
    diffFilter: 0,
    showEmpty: false,
    loadError: false,
    activeTab: 'all', // 'all' | 'liked' | 'bookmarked'
  },

  lifetimes: {
    attached() {
      const { statusBarHeight } = wx.getSystemInfoSync()
      const menuBtn = wx.getMenuButtonBoundingClientRect()
      // 搜索栏顶部 = 胶囊底部 + 20rpx间距(约10px)
      const searchBarTop = menuBtn.bottom + 10

      this.setData({
        statusBarHeight,
        searchBarTop,
      })

      // 延迟测量 top-bar 实际高度
      setTimeout(() => {
        const query = this.createSelectorQuery()
        query.select('.top-bar').boundingClientRect()
        query.exec((res: any[]) => {
          if (res[0]) {
            this.setData({ topBarHeight: res[0].height })
          }
        })
      }, 100)
    },
  },

  pageLifetimes: {
    show() {
      if (wx.getStorageSync('needsRefresh')) {
        wx.removeStorageSync('needsRefresh')
        this.refresh()
      } else if (this.data.recipes.length === 0) {
        this.refresh()
      }
    },
  },

  methods: {
    async refresh() {
      this.setData({ page: 0, noMore: false, recipes: [], showEmpty: false, loadError: false, hasLoadedMore: false })
      await this.loadRecipes(true)
    },

    onTabChange(e: any) {
      const tab = e.currentTarget.dataset.tab
      if (tab === this.data.activeTab) return
      this.setData({ activeTab: tab, diffFilter: 0 })
      // 切换 tab 后重新计算顶部高度
      setTimeout(() => this.updateTopBarHeight(), 50)
      this.refresh()
    },

    updateTopBarHeight() {
      const query = this.createSelectorQuery()
      query.select('.top-bar').boundingClientRect()
      query.exec((res: any[]) => {
        if (res[0]) {
          this.setData({ topBarHeight: res[0].height })
        }
      })
    },

    async loadRecipes(reset: boolean) {
      if (this.data.loading || this.data.loadingMore) return
      const page = reset ? 0 : this.data.page
      this.setData(reset ? { loading: true } : { loadingMore: true, hasLoadedMore: true })

      try {
        const { activeTab, diffFilter, searchKey } = this.data
        let recipes: Recipe[] = []

        if (activeTab === 'all') {
          // 全部菜谱
          const where: any = {}
          if (diffFilter > 0) where.difficulty = diffFilter
          if (searchKey) where.dishName = db.RegExp({ regexp: searchKey, options: 'i' })

          const res = await db.collection('recipes')
            .where(where)
            .orderBy('createdAt', 'desc')
            .skip(page * PAGE_SIZE)
            .limit(PAGE_SIZE)
            .get()

          const list = (res.data || []) as Recipe[]
          // 转换云存储文件ID为临时URL
          await this.convertRecipeImages(list)
          recipes = reset ? list : [...this.data.recipes, ...list]
          this.setData({
            recipes,
            page: page + 1,
            noMore: list.length < PAGE_SIZE,
            showEmpty: recipes.length === 0,
            loadError: false,
          })
        } else {
          // 我的点赞或我的收藏
          const collection = activeTab === 'liked' ? 'recipeLikes' : 'recipeBookmarks'
          const openid = app.globalData.openid

          // 先获取用户点赞/收藏的记录
          const statusRes = await db.collection(collection)
            .where({ _openid: openid })
            .orderBy('createdAt', 'desc')
            .skip(page * PAGE_SIZE)
            .limit(PAGE_SIZE)
            .get()

          const statusList = statusRes.data || []

          if (statusList.length > 0) {
            // 获取对应的菜谱
            const recipeIds = statusList.map((item: any) => item.recipeId)
            const recipeRes = await db.collection('recipes')
              .where({ _id: _.in(recipeIds) })
              .get()

            const recipeMap: Record<string, Recipe> = {}
            ;(recipeRes.data || []).forEach((r: any) => {
              recipeMap[r._id] = r as Recipe
            })

            // 按照点赞/收藏的顺序排列
            const list = recipeIds
              .map((id: string) => recipeMap[id])
              .filter(Boolean) as Recipe[]

            // 转换云存储文件ID为临时URL
            await this.convertRecipeImages(list)

            recipes = reset ? list : [...this.data.recipes, ...list]
            this.setData({
              recipes,
              page: page + 1,
              noMore: statusList.length < PAGE_SIZE,
              showEmpty: recipes.length === 0,
              loadError: false,
            })
          } else {
            recipes = reset ? [] : this.data.recipes
            this.setData({
              recipes,
              page: page + 1,
              noMore: true,
              showEmpty: recipes.length === 0,
              loadError: false,
            })
          }
        }
      } catch (e) {
        console.error('load recipes error', e)
        if (reset) {
          this.setData({ showEmpty: true, loadError: true })
        }
      } finally {
        this.setData({ loading: false, loadingMore: false, refreshing: false })
      }
    },

    // 将菜谱列表中的云存储文件ID转换为临时URL
    async convertRecipeImages(list: Recipe[]) {
      const fileIDs: string[] = []
      list.forEach(item => {
        if (item.coverImage && item.coverImage.startsWith('cloud://')) {
          fileIDs.push(item.coverImage)
        }
        if (item.createdByAvatar && item.createdByAvatar.startsWith('cloud://')) {
          fileIDs.push(item.createdByAvatar)
        }
      })
      if (fileIDs.length === 0) return

      try {
        // 通过云函数获取临时URL（服务端权限，可跨用户访问）
        const cfRes = await wx.cloud.callFunction({
          name: 'dishOp',
          data: { action: 'getTempFileURL', fileIDs: [...new Set(fileIDs)] }
        })
        const result = cfRes.result as any
        const urlMap: Record<string, string> = {}
        ;(result?.fileList || []).forEach((f: any) => {
          if (f.tempFileURL && f.fileID) {
            urlMap[f.fileID] = f.tempFileURL
          }
        })
        list.forEach(item => {
          if (item.coverImage && urlMap[item.coverImage]) {
            ;(item as any).coverImageUrl = urlMap[item.coverImage]
          }
          if (item.createdByAvatar && urlMap[item.createdByAvatar]) {
            ;(item as any).createdByAvatarUrl = urlMap[item.createdByAvatar]
          }
        })
      } catch (e) {
        console.error('转换图片URL失败:', e)
      }
    },

    onSearch(e: any) {
      this.setData({ searchKey: e.detail.value })
      this.refresh()
    },

    onClearSearch() {
      this.setData({ searchKey: '' })
      this.refresh()
    },

    onDiffFilter(e: any) {
      const val = +e.currentTarget.dataset.val
      this.setData({ diffFilter: this.data.diffFilter === val ? 0 : val })
      this.refresh()
    },

    onReachBottom() {
      if (!this.data.noMore) this.loadRecipes(false)
    },

    onPullDown() {
      this.setData({ refreshing: true })
      this.refresh()
    },

    goPublish() {
      wx.navigateTo({ url: '/pages/kitchen/publish/publish' })
    },

    goDetail(e: any) {
      const id = e.currentTarget.dataset.id
      wx.setStorageSync('detailRecipeId', id)
      wx.navigateTo({ url: '/pages/kitchen/detail/detail' })
    },

    onScroll(e: any) {},

    // 封面图加载失败 → 清空 src 显示占位图
    onCoverError(e: any) {
      const index = e.currentTarget.dataset.index
      if (index !== undefined) {
        this.setData({ [`recipes[${index}].coverImageUrl`]: '', [`recipes[${index}].coverImage`]: '' })
      }
    },

    // 头像加载失败 → 清空 src 显示占位图
    onAvatarError(e: any) {
      const index = e.currentTarget.dataset.index
      if (index !== undefined) {
        this.setData({ [`recipes[${index}].createdByAvatarUrl`]: '', [`recipes[${index}].createdByAvatar`]: '' })
      }
    },
  },
})
