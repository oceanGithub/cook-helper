const app = getApp<IAppOption>()
const db = wx.cloud.database()

interface Category {
  _id: string
  name: string
  level: number
  parentId: string | null
  sort: number
}

Component({
  data: {
    groupId: '',
    dishId: '',
    isEdit: false,

    // 分类
    categories1: [] as Category[],
    categories2: [] as Category[],
    l1Index: -1,
    l2Index: -1,
    l1Id: '',
    l2Id: '',

    // 表单
    name: '',
    rating: 0,
    address: '',
    note: '',
    images: [] as string[],
    xiaohongshuUrl: '',
    saving: false,
    loading: false,
  },

  lifetimes: {
    attached() {
      // 优先从 storage 读取（index 页面写入），URL 参数作为兜底
      const dishId = wx.getStorageSync('editDishId') || ''
      const isEdit = !!dishId

      wx.setNavigationBarTitle({
        title: isEdit ? '编辑菜品' : '新增菜品',
      })

      this.setData({
        groupId: wx.getStorageSync('currentGroupId') || '',
        dishId,
        isEdit,
      })

      this.loadCategories1().then(async () => {
        if (isEdit) {
          this.loadDish()
        } else {
          // 新增模式：回显首页选中的一级分类
          const preCatId = wx.getStorageSync('addDishCatId') || ''
          wx.removeStorageSync('addDishCatId')
          if (preCatId) {
            const idx = this.data.categories1.findIndex((c: any) => c._id === preCatId)
            if (idx >= 0) {
              this.setData({ l1Index: idx, l1Id: preCatId })
              await this.loadCategories2(preCatId)
            }
          }
        }
      })
    },
  },

  methods: {
    async loadCategories1() {
      const res = await db.collection('categories')
        .where({ groupId: this.data.groupId, level: 1 })
        .orderBy('sort', 'asc')
        .limit(100)
        .get()
      this.setData({ categories1: (res.data || []) as Category[] })
    },

    async loadCategories2(parentId: string) {
      const res = await db.collection('categories')
        .where({ groupId: this.data.groupId, level: 2, parentId })
        .orderBy('sort', 'asc')
        .limit(100)
        .get()
      const list = (res.data || []) as Category[]
      this.setData({ categories2: list })
    },

    async loadDish() {
      this.setData({ loading: true })
      try {
        const doc = await db.collection('dishes').doc(this.data.dishId).get()
        const d: any = doc.data
        if (!d) {
          wx.showToast({ title: '菜品不存在', icon: 'none' })
          return
        }
        const c1 = this.data.categories1
        let l1Index = -1
        let l1Id = ''
        let l2Index = -1
        let l2Id = ''

        const isL1 = c1.some(c => c._id === d.categoryId)
        if (isL1) {
          l1Id = d.categoryId
          l1Index = c1.findIndex(c => c._id === l1Id)
        } else {
          // 一次查询全部 L2，在内存中反查
          const allL2 = await db.collection('categories')
            .where({ groupId: this.data.groupId, level: 2 })
            .get()
          const l2 = allL2.data.find((s: any) => s._id === d.categoryId)
          if (l2) {
            l1Id = l2.parentId
            l1Index = c1.findIndex(c => c._id === l1Id)
            await this.loadCategories2(l1Id)
            l2Id = d.categoryId
            l2Index = this.data.categories2.findIndex(c => c._id === l2Id)
          }
        }

        this.setData({
          l1Index,
          l2Index,
          l1Id,
          l2Id,
          name: d.name || '',
          rating: d.rating || 0,
          address: d.address || '',
          note: d.note || '',
          images: d.images || (d.imageUrl ? [d.imageUrl] : []),
          xiaohongshuUrl: d.xiaohongshuUrl || '',
        })
      } catch (e) {
        console.error('加载菜品失败', e)
        wx.showToast({ title: '加载菜品失败', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },

    onL1Change(e: any) {
      const idx = +e.detail.value
      const cat = this.data.categories1[idx]
      this.setData({ l1Index: idx, l1Id: cat._id, l2Index: -1, l2Id: '', categories2: [] })
      this.loadCategories2(cat._id)
    },

    onL2Change(e: any) {
      const idx = +e.detail.value
      if (idx < 0) {
        this.setData({ l2Index: -1, l2Id: '' })
      } else {
        const cat = this.data.categories2[idx]
        this.setData({ l2Index: idx, l2Id: cat._id })
      }
    },

    clearL1() {
      this.setData({ l1Index: -1, l1Id: '', l2Index: -1, l2Id: '', categories2: [] })
    },
    clearL2() {
      this.setData({ l2Index: -1, l2Id: '' })
    },
    clearName() {
      this.setData({ name: '' })
    },

    onNameChange(e: any) { this.setData({ name: e.detail.value }) },
    onAddrChange(e: any) { this.setData({ address: e.detail.value }) },
    onNoteChange(e: any) { this.setData({ note: e.detail.value }) },
    onLinkChange(e: any) { this.setData({ xiaohongshuUrl: e.detail.value }) },
    clearLink() { this.setData({ xiaohongshuUrl: '' }) },

    onStarTap(e: any) {
      this.setData({ rating: +e.currentTarget.dataset.val })
    },

    previewImage(e: any) {
      const idx = e.currentTarget.dataset.index
      wx.previewImage({
        current: this.data.images[idx],
        urls: this.data.images,
      })
    },

    // 图片
    async chooseImage() {
      const remain = 5 - this.data.images.length
      if (remain <= 0) {
        wx.showToast({ title: '最多5张图片', icon: 'none' })
        return
      }
      try {
        const res = await wx.chooseMedia({
          count: remain,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
        })
        wx.showLoading({ title: '上传中' })
        const files = res.tempFiles
        const newImages: string[] = []
        for (const f of files) {
          const upload = await wx.cloud.uploadFile({
            cloudPath: `dishes/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
            filePath: f.tempFilePath,
          })
          newImages.push(upload.fileID)
        }
        this.setData({ images: [...this.data.images, ...newImages] })
        wx.hideLoading()
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      }
    },

    removeImage(e: any) {
      const idx = e.currentTarget.dataset.index
      const images = [...this.data.images]
      images.splice(idx, 1)
      this.setData({ images })
    },

    async save() {
      if (this.data.saving) return
      const name = this.data.name.trim()
      if (!name) {
        wx.showToast({ title: '请输入菜品名称', icon: 'none' })
        return
      }
      if (!this.data.l1Id) {
        wx.showToast({ title: '请选择一级分类', icon: 'none' })
        return
      }

      const categoryId = this.data.l2Id || this.data.l1Id
      const dishData: any = {
        groupId: this.data.groupId,
        name,
        categoryId,
        rating: this.data.rating,
        address: this.data.address.trim(),
        note: this.data.note.trim(),
        images: this.data.images,
        xiaohongshuUrl: this.data.xiaohongshuUrl.trim(),
        createdByName: app.globalData.userInfo?.nickName || '',
      }

      this.setData({ saving: true })
      try {
        if (this.data.isEdit) {
          await wx.cloud.callFunction({
            name: 'dishOp',
            data: { action: 'update', collection: 'dishes', id: this.data.dishId, data: dishData },
          })
        } else {
          const result = await wx.cloud.callFunction({
            name: 'dishOp',
            data: { action: 'add', collection: 'dishes', data: dishData },
          })
          // 从日历吃货计划页新增 → 回传新菜品 ID
          if (wx.getStorageSync('planPopupRestore')) {
            const res = result.result as { _id?: string }
            if (res?._id) wx.setStorageSync('planAddDishId', res._id)
          }
        }
        wx.setStorageSync('needsRefresh', true)
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 800)
      } catch (e) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      } finally {
        this.setData({ saving: false })
      }
    },
  },
})
