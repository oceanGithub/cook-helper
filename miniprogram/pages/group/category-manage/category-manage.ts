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
    categories1: [] as Category[],
    categories2: [] as Category[],
    expandedL1Id: '',

    // 编辑
    showEdit: false,
    editCatId: '',
    editCatName: '',
    saving: false,

    // 新增
    showAdd: false,
    catStep: 0 as 0 | 1 | 2,
    catLevel: 1 as 1 | 2,
    catParentId: '',
    catParentName: '',
    catNames: [''] as string[],
    lastAddedParentId: '',
    showParentPicker: false,
    loading: false,
    deleteMode: false,
    batchDeleting: false,
    selectedIds: [] as string[],
    allSelected: false,
    allCategories2: [] as Category[],
  },

  lifetimes: {
    attached() {
      const groupId = wx.getStorageSync('currentGroupId') || ''
      this.setData({ groupId })
      this.loadCategories1()
    },
  },

  methods: {
    async loadCategories1() {
      this.setData({ categories1: [], loading: true })
      try {
        const res = await db.collection('categories')
          .where({ groupId: this.data.groupId, level: 1 })
          .orderBy('sort', 'asc')
          .limit(100)
          .get()
        let list = (res.data || []) as Category[]
        // 去重：同名 L1 保留 sort 最小的
        const seen = new Map<string, Category>()
        for (const cat of list) {
          const prev = seen.get(cat.name)
          if (!prev || cat.sort < prev.sort) seen.set(cat.name, cat)
        }
        const dupes = list.filter(c => seen.get(c.name) !== c)
        for (const dup of dupes) {
          await db.collection('categories').doc(dup._id).remove()
        }
        if (dupes.length > 0) {
          const res2 = await db.collection('categories')
            .where({ groupId: this.data.groupId, level: 1 })
            .orderBy('sort', 'asc')
            .limit(100)
            .get()
          list = (res2.data || []) as Category[]
        }
        this.setData({ categories1: list })
      } catch (e) {
        console.error(e)
        wx.showToast({ title: '加载失败', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },

    async toggleL1(e: any) {
      const id = e.currentTarget.dataset.id
      if (this.data.expandedL1Id === id) {
        this.setData({ expandedL1Id: '', categories2: [] })
        return
      }
      await this.loadL2(id)
      this.setData({ expandedL1Id: id })
    },

    async loadL2(parentId: string) {
      try {
        const res = await db.collection('categories')
          .where({ groupId: this.data.groupId, level: 2, parentId })
          .orderBy('sort', 'asc')
          .limit(100)
          .get()
        let list = (res.data || []) as Category[]
        const seen = new Map<string, Category>()
        for (const cat of list) {
          const prev = seen.get(cat.name)
          if (!prev || cat.sort < prev.sort) seen.set(cat.name, cat)
        }
        const dupes = list.filter(c => seen.get(c.name) !== c)
        if (dupes.length > 0) {
          for (const dup of dupes) {
            await db.collection('categories').doc(dup._id).remove()
          }
          const res2 = await db.collection('categories')
            .where({ groupId: this.data.groupId, level: 2, parentId })
            .orderBy('sort', 'asc')
            .limit(100)
            .get()
          list = (res2.data || []) as Category[]
        }
        this.setData({ categories2: list })
      } catch (e) {
        console.error(e)
      }
    },

    // === 编辑 ===
    openEditCat(e: any) {
      const { id, name } = e.currentTarget.dataset
      this.setData({ showEdit: true, editCatId: id, editCatName: name })
    },
    onEditNameChange(e: any) {
      this.setData({ editCatName: e.detail.value })
    },
    closeEdit() {
      this.setData({ showEdit: false })
    },
    async doEditCat() {
      if (this.data.saving) return
      const name = this.data.editCatName.trim()
      if (!name) {
        wx.showToast({ title: '请输入分类名称', icon: 'none' })
        return
      }
      let cats = this.data.categories1
      let cfg = cats.find(c => c._id === this.data.editCatId)
      if (!cfg) {
        cats = this.data.categories2
        cfg = cats.find(c => c._id === this.data.editCatId)
      }
      // 同级同名检查
      if (cfg && cats.some(c => c.name === name && c._id !== cfg!._id && (cfg!.level === 1 || c.parentId === cfg!.parentId))) {
        wx.showToast({ title: '该分类名称已存在', icon: 'none' })
        return
      }
      this.setData({ saving: true })
      try {
        await db.collection('categories').doc(this.data.editCatId).update({
          data: { name },
        })
        this.setData({ showEdit: false })
        wx.showToast({ title: '已修改', icon: 'success' })
        wx.setStorageSync('needsRefresh', true)
        this.loadCategories1()
        if (this.data.expandedL1Id) this.loadL2(this.data.expandedL1Id)
      } catch (e) {
        wx.showToast({ title: '修改失败', icon: 'none' })
      } finally {
        this.setData({ saving: false })
      }
    },

    // === 删除 ===
    deleteCat(e: any) {
      const { id, level } = e.currentTarget.dataset
      const isL1 = level === '1'
      const title = isL1
        ? '删除一级分类将同时删除其下所有二级分类及菜品，确认删除？'
        : '删除后该分类下的菜品不会被删除，但将不再属于该分类。确认删除？'
      wx.showModal({
        title: '确认删除',
        content: title,
        confirmColor: '#e74c3c',
        success: async (res) => {
          if (!res.confirm) return
          wx.showLoading({ title: '删除中...', mask: true })
          try {
            const catIds = [id]
            if (isL1) {
              const subs = await db.collection('categories')
                .where({ parentId: id })
                .get()
              for (const sub of subs.data) {
                catIds.push(sub._id)
                await db.collection('categories').doc(sub._id).remove()
              }
              // 仅一级分类删除关联菜品
              for (const cid of catIds) {
                const dishes = await db.collection('dishes').where({ categoryId: cid }).get()
                for (const dish of dishes.data) {
                  await db.collection('dishes').doc(dish._id).remove()
                }
              }
            }
            await db.collection('categories').doc(id).remove()
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            wx.setStorageSync('needsRefresh', true)
            this.loadCategories1()
            if (this.data.expandedL1Id) {
              if (isL1 && this.data.expandedL1Id === id) {
                this.setData({ expandedL1Id: '', categories2: [] })
              } else if (!isL1) {
                this.loadL2(this.data.expandedL1Id)
              }
            }
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        },
      })
    },

    // === 批量删除 ===
    async enterDeleteMode() {
      this.setData({ deleteMode: true, selectedIds: [], allSelected: false, expandedL1Id: '' })
      const l1 = this.data.categories1.map(c => ({ ...c, _checked: false }))
      this.setData({ categories1: l1 })
      try {
        const res = await db.collection('categories')
          .where({ groupId: this.data.groupId, level: 2 })
          .orderBy('sort', 'asc')
          .get()
        const l2 = ((res.data || []) as Category[]).map(c => ({ ...c, _checked: false }))
        this.setData({ allCategories2: l2 })
      } catch (e) { /* ignore */ }
    },
    exitDeleteMode() {
      const l1 = this.data.categories1.map(c => ({ ...c, _checked: false }))
      this.setData({ deleteMode: false, selectedIds: [], allSelected: false, allCategories2: [], expandedL1Id: '', categories1: l1 })
    },
    toggleSelect(e: any) {
      const id = e.currentTarget.dataset.id
      const isL1 = this.data.categories1.some(c => c._id === id)
      let arr: string[]
      if (this.data.selectedIds.includes(id)) {
        arr = this.data.selectedIds.filter(x => x !== id)
        if (isL1) {
          const subIds = this.data.allCategories2.filter(c => c.parentId === id).map(c => c._id)
          arr = arr.filter(x => !subIds.includes(x))
        }
      } else {
        arr = [...this.data.selectedIds, id]
        if (isL1) {
          const subIds = this.data.allCategories2.filter(c => c.parentId === id).map(c => c._id)
          for (const sid of subIds) { if (!arr.includes(sid)) arr.push(sid) }
        }
      }
      const l1 = this.data.categories1.map(c => ({ ...c, _checked: arr.includes(c._id) }))
      const l2 = this.data.allCategories2.map(c => ({ ...c, _checked: arr.includes(c._id) }))
      const total = this.data.categories1.length + this.data.allCategories2.length
      this.setData({ selectedIds: arr, categories1: l1, allCategories2: l2, allSelected: total > 0 && arr.length >= total })
    },
    toggleSelectAll() {
      const allIds = [...this.data.categories1.map(c => c._id), ...this.data.allCategories2.map(c => c._id)]
      let ids: string[]
      if (this.data.selectedIds.length >= allIds.length) {
        ids = []
      } else {
        ids = allIds
      }
      const l1 = this.data.categories1.map(c => ({ ...c, _checked: ids.includes(c._id) }))
      const l2 = this.data.allCategories2.map(c => ({ ...c, _checked: ids.includes(c._id) }))
      this.setData({ selectedIds: ids, categories1: l1, allCategories2: l2, allSelected: allIds.length > 0 && ids.length >= allIds.length })
    },
    batchDelete() {
      if (!this.data.selectedIds.length) {
        wx.showToast({ title: '请选择要删除的分类', icon: 'none' })
        return
      }
      wx.showModal({
        title: '确认删除',
        content: `将删除选中的 ${this.data.selectedIds.length} 个分类及其关联菜品`,
        confirmColor: '#e74c3c',
        success: async (res) => {
          if (!res.confirm) return
          this.setData({ batchDeleting: true })
          try {
            const ids = [...this.data.selectedIds]
            for (const id of ids) {
              const subs = this.data.allCategories2.filter(c => c.parentId === id)
              for (const sub of subs) {
                if (!ids.includes(sub._id)) ids.push(sub._id)
              }
            }
            for (const cid of ids) {
              const dishes = await db.collection('dishes').where({ categoryId: cid }).get()
              for (const dish of dishes.data) {
                await db.collection('dishes').doc(dish._id).remove()
              }
              await db.collection('categories').doc(cid).remove()
            }
            wx.showToast({ title: `已删除 ${this.data.selectedIds.length} 个分类`, icon: 'success' })
            wx.setStorageSync('needsRefresh', true)
            this.setData({ selectedIds: [], batchDeleting: false })
            await this.loadCategories1()
            if (this.data.categories1.length === 0) {
              this.exitDeleteMode()
              return
            }
            const res2 = await db.collection('categories')
              .where({ groupId: this.data.groupId, level: 2 })
              .orderBy('sort', 'asc')
              .get()
            const l1 = this.data.categories1.map(c => ({ ...c, _checked: false }))
            const l2 = ((res2.data || []) as Category[]).map(c => ({ ...c, _checked: false }))
            this.setData({ categories1: l1, allCategories2: l2, allSelected: false })
          } catch (e) {
            this.setData({ batchDeleting: false })
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        },
      })
    },

    // === 新增 ===
    openAddPopup() {
      this.setData({ showAdd: true, catStep: 0, catNames: [''], catParentId: '', catParentName: '', lastAddedParentId: '' })
    },
    closeAddPopup() {
      this.setData({ showAdd: false })
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
      this.setData({ [`catNames[${idx}]`]: e.detail.value })
    },
    addCatRow() {
      if (this.data.catNames.length >= 5) {
        wx.showToast({ title: '最多添加5个分类', icon: 'none' })
        return
      }
      const arr = [...this.data.catNames, '']
      this.setData({ catNames: arr })
    },
    removeCatRow(e: any) {
      const idx = e.currentTarget.dataset.index
      const arr = this.data.catNames.filter((_, i) => i !== idx)
      this.setData({ catNames: arr.length ? arr : [''] })
    },
    async saveCategory() {
      if (this.data.saving) return
      if (this.data.catLevel === 1) {
        // L1: 批量创建
        const names = [...new Set(this.data.catNames.map(s => s.trim()).filter(Boolean))]
        if (!names.length) {
          wx.showToast({ title: '请输入分类名称', icon: 'none' })
          return
        }
        const dup = names.find(n => this.data.categories1.some(c => c.name === n))
        if (dup) {
          wx.showToast({ title: `分类「${dup}」已存在`, icon: 'none' })
          return
        }
        this.setData({ saving: true })
        try {
          const maxSort = this.data.categories1.reduce((max, c) => Math.max(max, c.sort || 0), 0)
          await Promise.all(names.map((name, i) =>
            db.collection('categories').add({
              data: {
                groupId: this.data.groupId,
                name,
                level: 1,
                parentId: null,
                sort: maxSort + i + 1,
              },
            })
          ))
          this.setData({ showAdd: false })
          wx.showToast({ title: `已添加 ${names.length} 个分类`, icon: 'success' })
          wx.setStorageSync('needsRefresh', true)
          this.loadCategories1()
          if (this.data.expandedL1Id) this.loadL2(this.data.expandedL1Id)
        } catch (e) {
          wx.showToast({ title: '添加失败', icon: 'none' })
        } finally {
          this.setData({ saving: false })
        }
        return
      }
      // L2: 单行添加（保持原有逻辑）
      const name = this.data.catNames[0]?.trim() || ''
      if (!name) {
        wx.showToast({ title: '请输入分类名称', icon: 'none' })
        return
      }
      if (!this.data.catParentId) {
        wx.showToast({ title: '请选择所属一级分类', icon: 'none' })
        return
      }
      if (this.data.categories2.some(c => c.name === name && c.parentId === this.data.catParentId)) {
        wx.showToast({ title: '该分类名称已存在', icon: 'none' })
        return
      }
      this.setData({ saving: true })
      try {
        await db.collection('categories').add({
          data: {
            groupId: this.data.groupId,
            name,
            level: 2,
            parentId: this.data.catParentId,
            sort: 99,
          },
        })
        this.setData({ showAdd: false })
        wx.showToast({ title: '已添加', icon: 'success' })
        wx.setStorageSync('needsRefresh', true)
        this.loadCategories1()
        if (this.data.expandedL1Id) this.loadL2(this.data.expandedL1Id)
      } catch (e) {
        wx.showToast({ title: '添加失败', icon: 'none' })
      } finally {
        this.setData({ saving: false })
      }
    },
    continueAddSub() {
      const parent = this.data.categories1.find(c => c._id === this.data.lastAddedParentId)
      this.setData({
        catLevel: 2, catStep: 1,
        catParentId: this.data.lastAddedParentId,
        catParentName: parent?.name || '', catNames: [''],
      })
    },
  },
})
