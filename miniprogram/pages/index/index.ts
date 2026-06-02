import { dedupeDefaultGroups, createDefaultGroup } from '../../utils/group'

const app = getApp<IAppOption>()
const db = wx.cloud.database()

interface Category {
  _id: string
  name: string
  level: number
  parentId: string | null
  sort: number
}

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
}

Component({
  data: {
    statusBarHeight: 20,
    openid: '',
    groups: [] as any[],
    currentGroupId: '',
    currentGroupName: '个人空间',
    categories1: [] as Category[],
    categories2: [] as Category[],
    activeCategoryId: '',
    groupedDishes: [] as { categoryId: string; categoryName: string; dishes: Dish[] }[],
    showCatPopup: false,
    showDeleteDialog: false,
    showRename: false,
    deleteDishId: '',
    dishDeleting: false,
    renameCatId: '',
    renameCatName: '',
    showCatAction: false,
    actionCatId: '',
    actionCatName: '',
    showCatDeleteDialog: false,
    catDeleting: false,
    catNames: [''] as string[],
    catParentId: '',
    catLevel: 1 as 1 | 2,
    catStep: 0 as 0 | 1 | 2,
    catParentName: '',
    lastAddedParentId: '',
    showParentPicker: false,
    loading: false,
    dishesLoading: false,
    catSaving: false,
    _initialized: false,
    _selectingCat: false,
    swipedCardId: '',
    swipeOffset: 0,
    swipeAnimated: false,
    _touchStartX: 0,
    _touchStartY: 0,
  },

  lifetimes: {
    attached() {
      const { statusBarHeight } = wx.getSystemInfoSync()
      this.setData({ statusBarHeight })
    },
  },
  pageLifetimes: {
    async show() {
      if (!app.globalData.loggedIn) {
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      try { await app.globalData.loginPromise } catch (e) {}
      const needsRefresh = wx.getStorageSync('needsRefresh')
      if (needsRefresh) {
        wx.removeStorageSync('needsRefresh')
        const gid = wx.getStorageSync('currentGroupId') || ''
        if (gid && gid !== this.data.currentGroupId) {
          await this.init()
          return
        }
        this.setData({ dishesLoading: true })
        try {
          await this.refreshCategories()
          await this.loadDishes()
        } catch (e) { console.error(e) }
        this.setData({ dishesLoading: false })
        return
      }
      if (!this.data._initialized) {
        this.setData({ _initialized: true })
        this.init()
      }
    },
  },

  methods: {
    async init() {
      this.setData({ loading: true })
      try {
        await app.globalData.loginPromise
        this.setData({ openid: app.globalData.openid, activeCategoryId: '', categories2: [] })
        await this.loadGroups()
        await this.initCategories()
        await this.loadDishes()
      } catch (e) {
        console.error(e)
        wx.showToast({ title: '加载失败，请下拉刷新', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },

    // ====== 小组 ======
    async loadGroups() {
      try {
        if (!wx.getStorageSync('_defaultGroupsDeduped')) {
          await dedupeDefaultGroups()
          wx.setStorageSync('_defaultGroupsDeduped', true)
        }

        const all = await db.collection('groups')
          .where({ memberIds: app.globalData.openid })
          .get()
        let gid = wx.getStorageSync('currentGroupId') || ''

        const hasDefault = all.data.some((g: any) => g.type === 'default')
        if (all.data.length === 0 || !hasDefault) {
          gid = await createDefaultGroup()
          const all2 = await db.collection('groups')
            .where({ memberIds: app.globalData.openid })
            .get()
          const g = all2.data.find((x: any) => x._id === gid)
          this.setData({
            groups: all2.data || [],
            currentGroupId: gid,
            currentGroupName: g ? g.name : '个人空间',
          })
        } else {
          if (!gid) {
            const defGroup = all.data.find((g: any) => g.type === 'default')
            if (defGroup) {
              gid = defGroup._id
              wx.setStorageSync('currentGroupId', gid)
            }
          }
          const g = all.data.find((x: any) => x._id === gid)
          this.setData({
            groups: all.data || [],
            currentGroupId: gid,
            currentGroupName: g ? g.name : '个人空间',
          })
        }
      } catch (e) {
        console.error(e)
      }
    },

    goGroupManage() {
      wx.navigateTo({ url: '/pages/group/manage/manage' })
    },

    goCategoryManage() {
      this.setData({ showCatPopup: false })
      wx.navigateTo({ url: '/pages/group/category-manage/category-manage' })
    },

    // ====== 分类 ======
    async initCategories() {
      const gid = this.data.currentGroupId
      if (!gid) return
      try {
        let c1 = await this.getCategories(1, null)

        const seen = new Map<string, Category>()
        for (const cat of c1) {
          const prev = seen.get(cat.name)
          if (!prev || cat.sort < prev.sort) seen.set(cat.name, cat)
        }
        const dupes = c1.filter(c => seen.get(c.name) !== c)
        for (const dup of dupes) {
          await db.collection('categories').doc(dup._id).remove()
        }
        if (dupes.length > 0) {
          c1 = await this.getCategories(1, null)
        }

        if (c1.length === 0) {
          this.setData({ categories1: [], categories2: [], activeCategoryId: '' })
        } else {
          this.setData({
            categories1: c1,
            activeCategoryId: this.data.activeCategoryId || c1[0]?._id || '',
          })
          if (c1[0]) await this.loadCategories2(this.data.activeCategoryId || c1[0]._id)
        }
      } catch (e) {
        console.error(e)
      }
    },

    async getCategories(level: number, parentId: string | null): Promise<Category[]> {
      const gid = this.data.currentGroupId
      const res = await db.collection('categories')
        .where({ groupId: gid, level, ...(parentId !== null ? { parentId } : {}) })
        .orderBy('sort', 'asc')
        .limit(100)
        .get()
      return (res.data || []) as Category[]
    },

    async loadCategories2(parentId: string) {
      const list = await this.getCategories(2, parentId)
      this.setData({ categories2: list })
    },

    selectCategory(e: any) {
      const id = e.detail.value || e.currentTarget.dataset.id
      if (id === this.data.activeCategoryId || this.data._selectingCat) return
      this.data._selectingCat = true
      this.setData({ activeCategoryId: id, dishesLoading: true })
      this.loadCategories2(id).then(() => {
        this.loadDishes().then(() => {
          this.setData({ dishesLoading: false })
          this.data._selectingCat = false
        })
      })
    },

    // ====== 左滑 ======
    onCardTouchStart(e: any) {
      this.data._touchStartX = e.touches[0].clientX
      this.data._touchStartY = e.touches[0].clientY
    },
    onCardTouchMove(e: any) {
      const dx = e.touches[0].clientX - this.data._touchStartX
      const dy = e.touches[0].clientY - this.data._touchStartY
      if (Math.abs(dy) > Math.abs(dx)) return
      const id = e.currentTarget.dataset.id
      if (dx < 0) {
        const offset = Math.max(dx, -160)
        this.setData({ swipedCardId: id, swipeOffset: offset, swipeAnimated: false })
      } else if (this.data.swipedCardId === id) {
        this.setData({ swipeOffset: Math.min(dx - 160, 0), swipeAnimated: false })
      }
    },
    onCardTouchEnd(e: any) {
      const id = e.currentTarget.dataset.id
      if (this.data.swipedCardId !== id) return
      if (this.data.swipeOffset < -60) {
        this.setData({ swipeOffset: -160, swipeAnimated: true })
      } else {
        this.resetSwipe()
      }
    },
    resetSwipe() {
      this.setData({ swipeOffset: 0, swipeAnimated: true, swipedCardId: '' })
    },

    // ====== 弹窗 ======
    openCatPopup() {
      this.setData({ showCatPopup: true, catStep: 0, catLevel: 1, catNames: [''], catParentId: '', catParentName: '' })
    },
    closeCatPopup() {
      this.setData({ showCatPopup: false })
      this.loadDishes()
    },
    selectCatType(e: any) {
      const level = e.currentTarget.dataset.level
      if (level === 2 && this.data.categories1.length === 0) {
        wx.showToast({ title: '请先创建一级分类', icon: 'none' })
        return
      }
      if (level === 2) {
        const first = this.data.categories1[0]
        this.setData({
          catLevel: 2, catStep: 1,
          catNames: [''],
          catParentId: this.data.catParentId || first?._id || '',
          catParentName: this.data.catParentName || first?.name || '',
          showParentPicker: false,
        })
      } else {
        this.setData({ catLevel: 1, catStep: 1, catNames: [''], showParentPicker: false })
      }
    },
    selectParentCat() {
      this.setData({ showParentPicker: !this.data.showParentPicker })
    },
    pickParent(e: any) {
      const { id, name } = e.currentTarget.dataset
      this.setData({ catParentId: id, catParentName: name, showParentPicker: false })
    },
    onCatNameChange(e: any) {
      const idx = e.currentTarget.dataset.index
      this.setData({ ['catNames[' + idx + ']']: e.detail.value })
    },
    addCatRow() {
      if (this.data.catNames.length >= 5) {
        wx.showToast({ title: '最多添加5个分类', icon: 'none' })
        return
      }
      this.setData({ catNames: [...this.data.catNames, ''] })
    },
    removeCatRow(e: any) {
      const idx = e.currentTarget.dataset.index
      const arr = this.data.catNames.filter((_: string, i: number) => i !== idx)
      this.setData({ catNames: arr.length ? arr : [''] })
    },
    async saveCategory() {
      if (this.data.catSaving) return
      if (this.data.catLevel === 1) {
        const names = [...new Set(this.data.catNames.map((s: string) => s.trim()).filter(Boolean))]
        if (!names.length) {
          wx.showToast({ title: '请输入分类名称', icon: 'none' })
          return
        }
        const dup = names.find((n: string) => this.data.categories1.some((c: Category) => c.name === n))
        if (dup) {
          wx.showToast({ title: `分类「${dup}」已存在`, icon: 'none' })
          return
        }
        this.setData({ catSaving: true })
        try {
          const maxSort = this.data.categories1.reduce((max: number, c: Category) => Math.max(max, c.sort || 0), 0)
          await Promise.all(names.map((name: string, i: number) =>
            db.collection('categories').add({
              data: {
                groupId: this.data.currentGroupId,
                name,
                level: 1,
                parentId: null,
                sort: maxSort + i + 1,
              },
            })
          ))
          this.setData({ showCatPopup: false })
          wx.showToast({ title: `已添加 ${names.length} 个分类`, icon: 'success' })
          wx.setStorageSync('needsRefresh', true)
          await this.refreshCategories()
          await this.loadDishes()
        } catch (e) {
          wx.showToast({ title: '添加失败', icon: 'none' })
        } finally {
          this.setData({ catSaving: false })
        }
        return
      }
      const name = this.data.catNames[0]?.trim() || ''
      if (!name) {
        wx.showToast({ title: '请输入分类名称', icon: 'none' })
        return
      }
      if (!this.data.catParentId) {
        wx.showToast({ title: '请选择所属一级分类', icon: 'none' })
        return
      }
      if (this.data.categories2.some((c: Category) => c.name === name)) {
        wx.showToast({ title: '该分类名称已存在', icon: 'none' })
        return
      }
      this.setData({ catSaving: true })
      try {
        await db.collection('categories').add({
          data: {
            groupId: this.data.currentGroupId,
            name,
            level: 2,
            parentId: this.data.catParentId,
            sort: 99,
          },
        })
        this.setData({ lastAddedParentId: this.data.catParentId, catStep: 2 })
        wx.setStorageSync('needsRefresh', true)
        this.refreshCategories()
        this.loadDishes()
      } catch (e) {
        wx.showToast({ title: '添加失败', icon: 'none' })
      } finally {
        this.setData({ catSaving: false })
      }
    },
    continueAddSub() {
      const parent = this.data.categories1.find((c: Category) => c._id === this.data.lastAddedParentId)
      this.setData({
        catLevel: 2, catStep: 1,
        catParentId: this.data.lastAddedParentId,
        catParentName: parent?.name || '', catNames: [''],
      })
    },

    async refreshCategories() {
      const c1 = await this.getCategories(1, null)
      this.setData({ categories1: c1 })
      const stillExists = c1.some((c: any) => c._id === this.data.activeCategoryId)
      if (c1.length > 0 && !stillExists) {
        this.setData({ activeCategoryId: c1[0]._id })
        await this.loadCategories2(c1[0]._id)
      } else if (this.data.activeCategoryId) {
        this.loadCategories2(this.data.activeCategoryId)
      }
    },

    // ====== 菜品列表 ======
    async loadDishes() {
      const gid = this.data.currentGroupId
      if (!this.data.activeCategoryId) return
      const l2Ids = this.data.categories2.map((c: Category) => c._id)
      const catId = db.command.in([this.data.activeCategoryId, ...l2Ids])
      try {
        const res = await db.collection('dishes')
          .where({ groupId: gid, categoryId: catId })
          .limit(100)
          .get()
        const dishes = (res.data || []) as Dish[]
        const grouped: Record<string, { categoryName: string; dishes: Dish[] }> = {}
        for (const dish of dishes) {
          const cat = this.data.categories2.find((c: Category) => c._id === dish.categoryId)
          const catName = cat?.name || '其他'
          const groupKey = cat ? cat._id : '__other__'
          if (!grouped[groupKey]) {
            grouped[groupKey] = { categoryName: catName, dishes: [] }
          }
          grouped[groupKey].dishes.push(dish)
        }
        const sorted = Object.entries(grouped).map(([categoryId, val]) => ({
          categoryId,
          categoryName: val.categoryName,
          dishes: val.dishes,
        }))
        sorted.sort((a, b) => {
          if (a.categoryName === '其他') return 1
          if (b.categoryName === '其他') return -1
          return a.categoryId.localeCompare(b.categoryId)
        })
        for (const group of sorted) {
          group.dishes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        }
        // cloud:// 图片转为可访问的临时 HTTPS URL（通过云函数）
        const allFileIds: string[] = []
        for (const group of sorted) {
          for (const dish of group.dishes) {
            if (dish.images) {
              for (const img of dish.images) {
                if (img && img.startsWith('cloud://')) allFileIds.push(img)
              }
            }
            if (dish.imageUrl && dish.imageUrl.startsWith('cloud://')) allFileIds.push(dish.imageUrl)
          }
        }
        if (allFileIds.length > 0) {
          try {
            const imgRes = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIds: allFileIds } })
            const urlMap = (imgRes.result as any)?.urlMap || {}
            for (const group of sorted) {
              for (const dish of group.dishes) {
                if (dish.images) {
                  dish.images = dish.images.map((img: string) => urlMap[img] || img)
                }
                if (dish.imageUrl && urlMap[dish.imageUrl]) dish.imageUrl = urlMap[dish.imageUrl]
              }
            }
          } catch (e) {
            console.error('获取图片URL失败', e)
          }
        }
        this.setData({ groupedDishes: sorted })
        this.resolveAllCreatorNames()
      } catch (e) {
        console.error(e)
      }
    },

    async resolveAllCreatorNames() {
      const groupedDishes = this.data.groupedDishes
      if (!groupedDishes || groupedDishes.length === 0) return

      // 收集所有菜品的 createdBy，查询最新用户信息
      const openids = new Set<string>()
      const dishesByOpenid: Record<string, { gi: number; di: number; dishId: string }[]> = {}
      for (let gi = 0; gi < groupedDishes.length; gi++) {
        const group = groupedDishes[gi]
        for (let di = 0; di < group.dishes.length; di++) {
          const dish = group.dishes[di]
          if (dish.createdBy) {
            openids.add(dish.createdBy)
            if (!dishesByOpenid[dish.createdBy]) dishesByOpenid[dish.createdBy] = []
            dishesByOpenid[dish.createdBy].push({ gi, di, dishId: dish._id })
          }
        }
      }
      if (openids.size === 0) return

      try {
        const res = await wx.cloud.callFunction({ name: 'getMemberInfos', data: { openids: [...openids] } })
        const infos = (res.result as any)?.list || []
        const nameMap: Record<string, string> = {}
        for (const info of infos) {
          if (info.nickName && info.nickName !== '匿名') nameMap[info.openid] = info.nickName
        }

        // 更新 UI 数据
        const updated = [...groupedDishes]
        for (const [openid, entries] of Object.entries(dishesByOpenid)) {
          const name = nameMap[openid]
          if (!name) continue
          for (const { gi, di } of entries) {
            const oldName = updated[gi].dishes[di].createdByName
            if (name === oldName) continue
            updated[gi] = { ...updated[gi], dishes: [...updated[gi].dishes] }
            updated[gi].dishes[di] = { ...updated[gi].dishes[di], createdByName: name }
          }
        }
        this.setData({ groupedDishes: updated })

        // 回写数据库（异步，不阻塞 UI）
        for (const [openid, entries] of Object.entries(dishesByOpenid)) {
          const name = nameMap[openid]
          if (!name) continue
          for (const { gi, di, dishId } of entries) {
            const oldName = groupedDishes[gi].dishes[di].createdByName
            if (name === oldName) continue
            db.collection('dishes').doc(dishId).update({ data: { createdByName: name } }).catch(() => {})
          }
        }
      } catch (e) {
        console.error('解析创建者名称失败', e)
      }
    },

    // ====== 导航 ======
    openDishDetail(e: any) {
      const id = e.currentTarget.dataset.id
      wx.setStorageSync('detailDishId', id)
      wx.navigateTo({ url: '/pages/dish/detail/detail' })
    },

    openAddDish() {
      wx.removeStorageSync('editDishId')
      wx.navigateTo({ url: '/pages/dish/edit/edit' })
    },

    openDishAdd() {
      wx.removeStorageSync('editDishId')
      wx.setStorageSync('addDishCatId', this.data.activeCategoryId || '')
      wx.navigateTo({ url: '/pages/dish/edit/edit' })
    },

    openPlanPage() {
      wx.navigateTo({ url: '/pages/calendar/calendar' })
    },

    openDishEdit(e: any) {
      this.resetSwipe()
      const dish: Dish = e.currentTarget.dataset.dish
      wx.setStorageSync('editDishId', dish._id)
      wx.navigateTo({ url: '/pages/dish/edit/edit' })
    },

    // ====== 删除确认 ======
    openDeleteDish(e: any) {
      this.setData({
        showDeleteDialog: true,
        deleteDishId: e.currentTarget.dataset.id,
        dishDeleting: false,
      })
    },
    async confirmDeleteDish() {
      if (this.data.dishDeleting) return
      this.setData({ dishDeleting: true })
      try {
        await wx.cloud.callFunction({
          name: 'dishOp',
          data: { action: 'remove', collection: 'dishes', id: this.data.deleteDishId },
        })
        this.setData({ showDeleteDialog: false })
        wx.showToast({ title: '已删除', icon: 'success' })
        await this.loadDishes()
      } catch (e) {
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ dishDeleting: false })
      }
    },

    // ====== 弹窗关闭 ======
    closeDeleteDialog() { this.resetSwipe(); this.setData({ showDeleteDialog: false, dishDeleting: false }) },

    // ====== 重命名分类 ======
    onSidebarLongPress(e: any) {
      const { id, name } = e.currentTarget.dataset
      this.setData({ showCatAction: true, actionCatId: id, actionCatName: name })
    },
    onRenameInput(e: any) {
      this.setData({ renameCatName: e.detail.value })
    },
    closeRename() {
      this.setData({ showRename: false, renameCatId: '', renameCatName: '' })
    },
    async doRenameCat() {
      if (this.data.catSaving) return
      const name = this.data.renameCatName.trim()
      if (!name) {
        wx.showToast({ title: '请输入分类名称', icon: 'none' })
        return
      }
      if (this.data.categories1.some((c: Category) => c.name === name && c._id !== this.data.renameCatId)) {
        wx.showToast({ title: '该分类名称已存在', icon: 'none' })
        return
      }
      this.setData({ catSaving: true })
      try {
        await db.collection('categories').doc(this.data.renameCatId).update({ data: { name } })
        this.setData({ showRename: false, renameCatId: '', renameCatName: '' })
        wx.showToast({ title: '已更新', icon: 'success' })
        this.refreshCategories()
      } catch (e) {
        wx.showToast({ title: '更新失败', icon: 'none' })
      } finally {
        this.setData({ catSaving: false })
      }
    },

    // ====== 长按操作菜单 ======
    closeCatAction() {
      this.setData({ showCatAction: false, actionCatId: '', actionCatName: '' })
    },
    onActionRename() {
      const { actionCatId: id, actionCatName: name } = this.data
      this.setData({ showCatAction: false, showRename: true, renameCatId: id, renameCatName: name })
    },
    onActionDelete() {
      this.setData({ showCatAction: false, showCatDeleteDialog: true, catDeleting: false })
    },
    closeCatDeleteDialog() {
      this.setData({ showCatDeleteDialog: false, actionCatId: '', actionCatName: '', catDeleting: false })
    },
    async confirmDeleteCat() {
      if (this.data.catDeleting) return
      const id = this.data.actionCatId
      const gid = this.data.currentGroupId
      this.setData({ catDeleting: true })
      try {
        const l2Res = await db.collection('categories')
          .where({ groupId: gid, level: 2, parentId: id }).get()
        const catIds = [id, ...l2Res.data.map((c: any) => c._id)]

        // 批量删除关联菜品
        for (const cid of catIds) {
          await db.collection('dishes').where({ groupId: gid, categoryId: cid }).remove()
        }
        // 批量删除 L2 分类
        await db.collection('categories').where({ groupId: gid, level: 2, parentId: id }).remove()
        // 删除 L1 分类
        await db.collection('categories').doc(id).remove()

        this.setData({ showCatDeleteDialog: false, actionCatId: '', actionCatName: '' })
        wx.showToast({ title: '已删除', icon: 'success' })
        const wasActive = this.data.activeCategoryId === id
        if (wasActive) {
          this.setData({ activeCategoryId: '', categories2: [], groupedDishes: [] })
        }
        await this.refreshCategories()
        if (wasActive) {
          const firstId = this.data.categories1[0]?._id || ''
          if (firstId) {
            this.setData({ activeCategoryId: firstId })
            await this.loadCategories2(firstId)
          }
        }
        await this.loadDishes()
      } catch (e) {
        console.error('删除分类失败', e)
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ catDeleting: false })
      }
    },

  },
})
