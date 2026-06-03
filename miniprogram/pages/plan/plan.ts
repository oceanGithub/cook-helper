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

    async loadRecipes(reset: boolean) {
      if (this.data.loading || this.data.loadingMore) return
      const page = reset ? 0 : this.data.page
      this.setData(reset ? { loading: true } : { loadingMore: true, hasLoadedMore: true })

      try {
        const where: any = {}
        if (this.data.diffFilter > 0) where.difficulty = this.data.diffFilter
        if (this.data.searchKey) where.dishName = db.RegExp({ regexp: this.data.searchKey, options: 'i' })

        const res = await db.collection('recipes')
          .where(where)
          .orderBy('createdAt', 'desc')
          .skip(page * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .get()

        const list = (res.data || []) as Recipe[]
        const recipes = reset ? list : [...this.data.recipes, ...list]
        this.setData({
          recipes,
          page: page + 1,
          noMore: list.length < PAGE_SIZE,
          showEmpty: recipes.length === 0,
          loadError: false,
        })
      } catch (e) {
        console.error('load recipes error', e)
        if (reset) {
          this.setData({ showEmpty: true, loadError: true })
        }
      } finally {
        this.setData({ loading: false, loadingMore: false, refreshing: false })
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
  },
})
