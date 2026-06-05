const app = getApp<IAppOption>()
const db = wx.cloud.database()

interface Dish {
  _id: string
  name: string
  images?: string[]
  imageUrl?: string
  categoryId?: string
  categoryName?: string
  rating?: number
  groupId?: string
}

interface Group {
  _id: string
  name: string
}

interface CustomDish {
  id: string
  name: string
  checked: boolean
}

interface DefaultDish {
  name: string
  checked: boolean
  isSystem: boolean  // 是否为系统预设（不可删除）
}

Component({
  data: {
    loading: true,
    // 抽取池相关
    poolDishes: [] as Dish[],
    allDishes: [] as Dish[],
    // 分组和菜品池选择
    groups: [] as Group[],
    groupDishes: {} as Record<string, Dish[]>,
    selectedGroupIds: [] as string[],
    selectedDishIds: [] as string[],
    showPoolModal: false,
    activeGroupTab: '',
    currentGroupDishes: [] as (Dish & { _checked: boolean })[],
    isGroupAllSelected: false,
    // 自定义菜品相关
    activePoolTab: 'default' as 'default' | 'group' | 'custom',
    customDishName: '',
    customDishes: [] as CustomDish[],
    isCustomAllSelected: false,
    checkedCustomCount: 0,
    // 默认设置相关
    defaultPoolDishes: [] as DefaultDish[],
    defaultDishName: '',
    isDefaultAllSelected: false,
    checkedDefaultCount: 0,
    userDefaultPoolId: '',  // 用户默认设置的记录ID
    systemDefaultDishes: [] as string[],  // 系统默认菜品列表
    // 抽取相关
    isRolling: false,
    showResult: false,
    currentDish: null as Dish | null,
    rollingName: '',
    rollingIndex: 0,
    // 历史记录
    history: [] as Dish[],
  },
  lifetimes: {
    attached() {
      this.initData()
    },
  },
  methods: {
    // 初始化数据
    async initData() {
      this.setData({ loading: true })
      try {
        // 并行加载默认设置和分组数据
        await Promise.all([
          this.loadDefaultPool(),
          this.loadGroups()
        ])
        // 默认选中当前分组
        const currentGid = wx.getStorageSync('currentGroupId') || ''
        if (currentGid && this.data.groups.some(g => g._id === currentGid)) {
          this.setData({ activeGroupTab: currentGid })
        } else if (this.data.groups.length > 0) {
          this.setData({ activeGroupTab: this.data.groups[0]._id })
        }
        await this.loadAllDishes()
        this.initDefaultSelection()
        // 默认使用默认设置的抽取池
        this.updatePoolFromDefault()
      } catch (e) {
        console.error('初始化失败', e)
        wx.showToast({ title: '加载失败', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },

    // 加载分组列表
    async loadGroups() {
      try {
        const res = await db.collection('groups')
          .where({ memberIds: app.globalData.openid })
          .limit(20)
          .get()
        this.setData({ groups: res.data || [] })
      } catch (e) {
        console.error('加载分组失败', e)
      }
    },

    // 加载所有分组的菜品
    async loadAllDishes() {
      const { groups } = this.data
      const groupDishes: Record<string, Dish[]> = {}
      const allDishes: Dish[] = []
      const fileIDs: string[] = []

      const promises = groups.map(async (group) => {
        try {
          const res = await db.collection('dishes')
            .where({ groupId: group._id })
            .limit(100)
            .get()
          const dishes = (res.data || []) as Dish[]
          groupDishes[group._id] = dishes
          allDishes.push(...dishes)
          for (const dish of dishes) {
            if (dish.images && dish.images.length > 0) {
              fileIDs.push(...dish.images.filter(url => url && url.startsWith('cloud://')))
            }
            if (dish.imageUrl && dish.imageUrl.startsWith('cloud://')) {
              fileIDs.push(dish.imageUrl)
            }
          }
        } catch (e) {
          console.error(`加载分组${group.name}菜品失败`, e)
          groupDishes[group._id] = []
        }
      })

      await Promise.all(promises)

      if (fileIDs.length > 0) {
        await this.refreshImageURLs(allDishes, fileIDs)
      }

      this.setData({ groupDishes, allDishes })
    },

    // 刷新图片URL
    async refreshImageURLs(dishes: Dish[], fileIDs: string[]) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'dishOp',
          data: { action: 'getTempFileURL', fileIDs }
        })
        const result = res.result as any
        const urlMap: Record<string, string> = {}
        for (const file of result?.fileList || []) {
          if (file.tempFileURL && file.fileID) {
            urlMap[file.fileID] = file.tempFileURL
          }
        }
        for (const dish of dishes) {
          if (dish.images && dish.images.length > 0) {
            dish.images = dish.images.map(url => urlMap[url] || url)
          }
          if (dish.imageUrl && urlMap[dish.imageUrl]) {
            dish.imageUrl = urlMap[dish.imageUrl]
          }
        }
      } catch (e) {
        console.error('刷新图片失败', e)
      }
    },

    // 初始化默认选择
    initDefaultSelection() {
      const currentGid = this.data.activeGroupTab
      if (!currentGid) return
      const dishes = this.data.groupDishes[currentGid] || []
      this.setData({
        selectedDishIds: dishes.map(d => d._id),
        selectedGroupIds: [currentGid]
      })
    },

    // ====== 默认设置相关 ======

    // 加载默认设置
    async loadDefaultPool() {
      try {
        // 系统默认菜品列表
        const systemDishes = [
          '寿司郎', '肉肉大米', '海底捞', '牛肉火锅', '烤肉', '椰子鸡',
          '费大厨', '美蛙鱼头', '点品集', '烧烤', '烤鱼', '自助'
        ]
        this.setData({ systemDefaultDishes: systemDishes })

        // 查询用户的默认设置（仅创建者可读写权限会自动过滤当前用户数据）
        const res = await db.collection('userDefaultPool')
          .limit(1)
          .get()

        if (res.data.length > 0) {
          // 用户已有默认设置
          const userPool = res.data[0]
          const userDishes = userPool.dishes || []
          this.setData({ userDefaultPoolId: userPool._id })
          this.buildDefaultPoolDishes(systemDishes, userDishes)
        } else {
          // 首次使用，创建用户的默认设置
          const addRes = await db.collection('userDefaultPool').add({
            data: {
              dishes: [...systemDishes],
              createdAt: db.serverDate()
            }
          })
          this.setData({ userDefaultPoolId: addRes._id })
          this.buildDefaultPoolDishes(systemDishes, systemDishes)
        }
      } catch (e) {
        console.error('加载默认设置失败', e)
      }
    },

    // 构建默认设置菜品列表
    buildDefaultPoolDishes(systemDishes: string[], userDishes: string[]) {
      const dishes: DefaultDish[] = []
      const userDishSet = new Set(userDishes)

      // 添加用户菜品（包括系统和用户自定义的）
      for (const name of userDishes) {
        dishes.push({
          name,
          checked: true,
          isSystem: systemDishes.includes(name)
        })
      }

      this.setData({
        defaultPoolDishes: dishes,
        isDefaultAllSelected: dishes.every(d => d.checked),
        checkedDefaultCount: dishes.filter(d => d.checked).length
      })
    },

    // 从默认设置更新抽取池
    updatePoolFromDefault() {
      const checkedDishes = this.data.defaultPoolDishes.filter(d => d.checked)
      const pool = checkedDishes.map(d => ({
        _id: 'default_' + d.name,
        name: d.name,
        isDefault: true
      }))
      this.setData({ poolDishes: pool })
    },

    // 切换默认菜品选中状态
    toggleDefaultDish(e: WechatMiniprogram.TouchEvent) {
      const name = e.currentTarget.dataset.name
      const dishes = this.data.defaultPoolDishes.map(d =>
        d.name === name ? { ...d, checked: !d.checked } : d
      )
      this.setData({
        defaultPoolDishes: dishes,
        isDefaultAllSelected: dishes.every(d => d.checked),
        checkedDefaultCount: dishes.filter(d => d.checked).length
      })
    },

    // 全选/取消全选默认设置
    toggleSelectAllDefault() {
      const { defaultPoolDishes, isDefaultAllSelected } = this.data
      const dishes = defaultPoolDishes.map(d => ({ ...d, checked: !isDefaultAllSelected }))
      this.setData({
        defaultPoolDishes: dishes,
        isDefaultAllSelected: !isDefaultAllSelected,
        checkedDefaultCount: dishes.filter(d => d.checked).length
      })
    },

    // 添加菜品到默认设置
    addDefaultDish() {
      const name = this.data.defaultDishName.trim()
      if (!name) {
        wx.showToast({ title: '请输入菜品名称', icon: 'none' })
        return
      }
      if (this.data.defaultPoolDishes.some(d => d.name === name)) {
        wx.showToast({ title: '菜品名称已存在', icon: 'none' })
        return
      }

      const newDish: DefaultDish = {
        name,
        checked: true,
        isSystem: false
      }
      const dishes = [...this.data.defaultPoolDishes, newDish]
      this.setData({
        defaultPoolDishes: dishes,
        defaultDishName: '',
        checkedDefaultCount: dishes.filter(d => d.checked).length
      })
      // 保存到数据库
      this.saveDefaultPool()
    },

    // 删除默认设置中的菜品
    removeDefaultDish(e: WechatMiniprogram.TouchEvent) {
      const name = e.currentTarget.dataset.name
      wx.showModal({
        title: '删除确认',
        content: `确定要删除"${name}"吗？删除后可点击"重置为默认"恢复`,
        success: (res) => {
          if (res.confirm) {
            const dishes = this.data.defaultPoolDishes.filter(d => d.name !== name)
            this.setData({
              defaultPoolDishes: dishes,
              checkedDefaultCount: dishes.filter(d => d.checked).length
            })
            // 保存到数据库
            this.saveDefaultPool()
            // 同步更新抽取池（移除被删除的菜品）
            const pool = this.data.poolDishes.filter(d => d.name !== name)
            this.setData({ poolDishes: pool })
          }
        }
      })
    },

    // 保存默认设置到数据库
    async saveDefaultPool() {
      try {
        const dishes = this.data.defaultPoolDishes.map(d => d.name)
        await db.collection('userDefaultPool').doc(this.data.userDefaultPoolId).update({
          data: { dishes }
        })
      } catch (e) {
        console.error('保存默认设置失败', e)
      }
    },

    // 重置为系统默认数据
    resetDefaultPool() {
      wx.showModal({
        title: '重置确认',
        content: '确定要重置为系统默认菜品吗？您的所有修改将丢失',
        success: async (res) => {
          if (res.confirm) {
            const systemDishes = this.data.systemDefaultDishes
            const dishes: DefaultDish[] = systemDishes.map(name => ({
              name,
              checked: true,
              isSystem: true
            }))

            this.setData({
              defaultPoolDishes: dishes,
              isDefaultAllSelected: true,
              checkedDefaultCount: dishes.length
            })

            // 保存到数据库
            try {
              await db.collection('userDefaultPool').doc(this.data.userDefaultPoolId).update({
                data: { dishes: [...systemDishes] }
              })
              wx.showToast({ title: '已重置', icon: 'success' })
            } catch (e) {
              console.error('重置失败', e)
              wx.showToast({ title: '重置失败', icon: 'none' })
            }
          }
        }
      })
    },

    // 输入默认菜品名称
    onDefaultDishInput(e: WechatMiniprogram.Input) {
      this.setData({ defaultDishName: e.detail.value })
    },

    // 打开抽取池设置弹窗
    openPoolModal() {
      this.setData({ showPoolModal: true })
      this.updateCurrentGroupDishes()
    },

    // 关闭抽取池设置弹窗
    closePoolModal() {
      this.setData({ showPoolModal: false })
    },

    // 切换分组Tab
    switchGroupTab(e: WechatMiniprogram.TouchEvent) {
      this.setData({ activeGroupTab: e.currentTarget.dataset.id })
      this.updateCurrentGroupDishes()
    },

    // 更新当前分组的菜品列表
    updateCurrentGroupDishes() {
      const { activeGroupTab, groupDishes, selectedDishIds } = this.data
      const dishes = groupDishes[activeGroupTab] || []
      const dishSet = new Set(selectedDishIds)
      this.setData({
        currentGroupDishes: dishes.map(d => ({ ...d, _checked: dishSet.has(d._id) })),
        isGroupAllSelected: dishes.length > 0 && dishes.every(d => dishSet.has(d._id))
      })
    },

    // 切换分组选择
    toggleGroup(e: WechatMiniprogram.TouchEvent) {
      const groupId = e.currentTarget.dataset.id
      const groupSet = new Set(this.data.selectedGroupIds)
      const dishSet = new Set(this.data.selectedDishIds)
      const dishes = this.data.groupDishes[groupId] || []

      if (groupSet.has(groupId)) {
        groupSet.delete(groupId)
        dishes.forEach(d => dishSet.delete(d._id))
      } else {
        groupSet.add(groupId)
        dishes.forEach(d => dishSet.add(d._id))
      }

      this.setData({
        selectedGroupIds: [...groupSet],
        selectedDishIds: [...dishSet]
      })
      this.updateCurrentGroupDishes()
    },

    // 切换单个菜品
    toggleDish(e: WechatMiniprogram.TouchEvent) {
      const dishId = e.currentTarget.dataset.id
      const dishSet = new Set(this.data.selectedDishIds)
      const groupSet = new Set(this.data.selectedGroupIds)

      if (dishSet.has(dishId)) {
        dishSet.delete(dishId)
      } else {
        dishSet.add(dishId)
      }

      // 检查当前分组是否全选
      const currentDishes = this.data.groupDishes[this.data.activeGroupTab] || []
      const allChecked = currentDishes.length > 0 && currentDishes.every(d => dishSet.has(d._id))
      if (allChecked) {
        groupSet.add(this.data.activeGroupTab)
      } else {
        groupSet.delete(this.data.activeGroupTab)
      }

      this.setData({
        selectedDishIds: [...dishSet],
        selectedGroupIds: [...groupSet]
      })
      this.updateCurrentGroupDishes()
    },

    // 全选/取消全选当前分组
    toggleSelectAll() {
      const { activeGroupTab, groupDishes, selectedDishIds, selectedGroupIds, isGroupAllSelected } = this.data
      const dishes = groupDishes[activeGroupTab] || []
      const dishSet = new Set(selectedDishIds)
      const groupSet = new Set(selectedGroupIds)

      if (isGroupAllSelected) {
        dishes.forEach(d => dishSet.delete(d._id))
        groupSet.delete(activeGroupTab)
      } else {
        dishes.forEach(d => dishSet.add(d._id))
        groupSet.add(activeGroupTab)
      }

      this.setData({
        selectedDishIds: [...dishSet],
        selectedGroupIds: [...groupSet]
      })
      this.updateCurrentGroupDishes()
    },

    // ====== 自定义菜品相关 ======

    // 更新自定义菜品全选状态和选中数量
    updateCustomAllSelected() {
      const { customDishes } = this.data
      const isAll = customDishes.length > 0 && customDishes.every(d => d.checked)
      const checkedCount = customDishes.filter(d => d.checked).length
      this.setData({
        isCustomAllSelected: isAll,
        checkedCustomCount: checkedCount
      })
    },

    // 切换抽取池Tab
    switchPoolTab(e: WechatMiniprogram.TouchEvent) {
      const tab = e.currentTarget.dataset.tab as 'default' | 'group' | 'custom'
      this.setData({ activePoolTab: tab })
    },

    // 输入自定义菜品名称
    onCustomDishInput(e: WechatMiniprogram.Input) {
      this.setData({ customDishName: e.detail.value })
    },

    // 添加自定义菜品
    addCustomDish() {
      const name = this.data.customDishName.trim()
      if (!name) {
        wx.showToast({ title: '请输入菜品名称', icon: 'none' })
        return
      }
      // 检查是否重复
      if (this.data.customDishes.some(d => d.name === name)) {
        wx.showToast({ title: '菜品名称已存在', icon: 'none' })
        return
      }
      const newDish: CustomDish = {
        id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name,
        checked: true
      }
      this.setData({
        customDishes: [...this.data.customDishes, newDish],
        customDishName: ''
      })
      this.updateCustomAllSelected()
    },

    // 删除自定义菜品
    removeCustomDish(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id
      // 找到被删除的菜品名称
      const deletedDish = this.data.customDishes.find(d => d.id === id)
      this.setData({
        customDishes: this.data.customDishes.filter(d => d.id !== id)
      })
      this.updateCustomAllSelected()
      // 同步更新抽取池（移除被删除的菜品）
      if (deletedDish) {
        const pool = this.data.poolDishes.filter(d => d.name !== deletedDish.name)
        this.setData({ poolDishes: pool })
      }
    },

    // 切换自定义菜品选中状态
    toggleCustomDish(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id
      this.setData({
        customDishes: this.data.customDishes.map(d =>
          d.id === id ? { ...d, checked: !d.checked } : d
        )
      })
      this.updateCustomAllSelected()
    },

    // 全选/取消全选自定义菜品
    toggleSelectAllCustom() {
      const { customDishes, isCustomAllSelected } = this.data
      const newChecked = !isCustomAllSelected
      this.setData({
        customDishes: customDishes.map(d => ({ ...d, checked: newChecked })),
        isCustomAllSelected: newChecked,
        checkedCustomCount: newChecked ? customDishes.length : 0
      })
    },

    // 更新抽取池菜品（合并分组菜品和自定义菜品）
    // 从分组菜品更新抽取池
    updatePoolFromGroup() {
      const { selectedDishIds, allDishes } = this.data
      let pool: any[] = []
      if (selectedDishIds.length > 0) {
        const dishSet = new Set(selectedDishIds)
        pool = allDishes.filter(d => dishSet.has(d._id))
      }
      this.setData({ poolDishes: pool })
    },

    // 从自定义菜品更新抽取池
    updatePoolFromCustom() {
      const { customDishes } = this.data
      const checkedCustom = customDishes.filter(d => d.checked)
      const pool = checkedCustom.map(d => ({
        _id: d.id,
        name: d.name,
        isCustom: true
      }))
      this.setData({ poolDishes: pool })
    },

    // 确认选择
    confirmPool() {
      const { activePoolTab } = this.data
      if (activePoolTab === 'default') {
        this.updatePoolFromDefault()
      } else if (activePoolTab === 'group') {
        this.updatePoolFromGroup()
      } else {
        this.updatePoolFromCustom()
      }
      this.closePoolModal()
      // 重置抽取状态
      this.setData({
        showResult: false,
        currentDish: null,
        isRolling: false
      })
      wx.showToast({ title: `已选择 ${this.data.poolDishes.length} 道菜品`, icon: 'none' })
    },

    // 开始抽取
    startRoll() {
      if (this.data.isRolling) return
      if (this.data.poolDishes.length === 0) {
        wx.showToast({ title: '抽取池为空，请先选择菜品', icon: 'none' })
        return
      }
      this.setData({ isRolling: true, showResult: false })
      this.rollAnimation(0)
    },

    // 滚动动画
    rollAnimation(count: number) {
      const { poolDishes } = this.data
      const maxCount = 20
      const delay = 50 + count * 25
      const randomIndex = Math.floor(Math.random() * poolDishes.length)
      const dish = poolDishes[randomIndex]

      this.setData({ rollingName: dish.name, rollingIndex: randomIndex })

      if (count < maxCount) {
        setTimeout(() => this.rollAnimation(count + 1), delay)
      } else {
        setTimeout(() => {
          this.setData({
            isRolling: false,
            showResult: true,
            currentDish: dish,
            history: [dish, ...this.data.history.slice(0, 9)],
          })
        }, 300)
      }
    },

    // 重新抽取
    reRoll() {
      this.startRoll()
    },

    // 查看详情
    goDetail() {
      const { currentDish } = this.data
      if (!currentDish) return
      wx.setStorageSync('detailDishId', currentDish._id)
      wx.navigateTo({ url: '/pages/dish/detail/detail' })
    },
  },
})
