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
}

interface Plan {
  _id: string
  groupId: string
  date: string
  dishId: string
  createdBy: string
  createdByName: string
}

interface CalendarDay {
  date: string
  day: number
  isToday: boolean
  isSelected: boolean
  isCurrentMonth: boolean
  hasPlan: boolean
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const MEAL_TYPES = [
  { value: 'breakfast', label: '早餐', icon: '☀️' },
  { value: 'lunch', label: '午餐', icon: '🌤️' },
  { value: 'afternoon_tea', label: '下午茶', icon: '🌿' },
  { value: 'dinner', label: '晚餐', icon: '🌙' },
  { value: 'late_night', label: '宵夜', icon: '🏙️' },
]

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

Component({
  data: {
    currentYear: 0,
    currentMonth: 0,
    today: '',
    tomorrow: '',
    tomorrowLabel: '',
    selectedDate: '',
    weekdays: WEEKDAYS,
    calendarDays: [] as CalendarDay[],
    plansLoaded: false,
    dishesLoading: false,

    // 餐次
    mealTypes: MEAL_TYPES,
    mealFilter: '',

    // 今日菜品
    dateDishes: [] as { planId: string; dish: Dish; partnerIds?: string[]; mealType?: string; reminderEnabled?: boolean }[],
    filteredDateDishes: [] as { planId: string; dish: Dish; partnerIds?: string[]; mealType?: string; reminderEnabled?: boolean }[],

    // 吃货计划弹窗
    showPlanPopup: false,
    planStep: 0 as 0 | 1 | 2 | 3,
    planDate: '',
    planDishSearch: '',
    planCatFilter: '',
    allDishes: [] as Dish[],
    filteredDishes: [] as Dish[],
    categories1: [] as { _id: string; name: string }[],
    selectedDishIds: [] as string[],
    selectedMealType: '',

    // 搭档选择
    eatAlone: true,
    partners: [] as { openid: string; nickName: string; avatarUrl: string }[],
    selectedPartnerIds: [] as string[],

    // 删除确认
    showDeleteDialog: false,
    planDeleting: false,
    deletePlanId: '',

    // 计划保存中
    planSaving: false,

    // 订阅消息
    subscribeTmplId: '5jq7RwQHoM3KUL18Smm3x0FxtsCpEZFWqelsnxckzwk',
  },

  // 搜索防抖定时器
  _searchTimer: 0 as any,

  pageLifetimes: {
    async show() {
      if (!app.globalData.loggedIn) {
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      try { await app.globalData.loginPromise } catch (e) {}

      // 从新增菜品页返回时需要恢复弹窗并勾选新菜品
      const planRestore = wx.getStorageSync('planPopupRestore')
      if (planRestore) {
        wx.removeStorageSync('planPopupRestore')
        const newDishId = wx.getStorageSync('planAddDishId')
        wx.removeStorageSync('planAddDishId')
        this.setData({
          showPlanPopup: true,
          planStep: planRestore.planStep,
          planDate: planRestore.planDate,
          planCatFilter: planRestore.planCatFilter,
          planDishSearch: '',
        })
        this.loadAllDishes().then(() => {
          if (newDishId) {
            const selected = new Set(this.data.selectedDishIds)
            selected.add(newDishId)
            this.setData({ selectedDishIds: [...selected] })
          }
          this.applyDishFilter()
        })
        return
      }

      // 首次加载走 init，后续切 tab 不再请求保留上次状态
      if (wx.getStorageSync('needsRefresh')) {
        wx.removeStorageSync('needsRefresh')
        await this.loadMonthPlans()
        await this.loadDateDishes()
      } else if (!this.data.plansLoaded) {
        this.init()
      }
    },
  },

  methods: {
    async init() {
      const now = new Date()
      const today = fmtDate(now)
      const tomorrow = fmtDate(new Date(now.getTime() + 86400000))
      this.setData({
        currentYear: now.getFullYear(),
        currentMonth: now.getMonth() + 1,
        today,
        tomorrow,
        tomorrowLabel: `${now.getMonth() + 1}月${new Date(now.getTime() + 86400000).getDate()}日`,
        selectedDate: today,
        plansLoaded: true,
      })
      this.buildCalendar()
      await this.loadMonthPlans()
      await this.loadDateDishes()
    },

    // ====== 日历构建 ======
    buildCalendar() {
      const { currentYear, currentMonth, today, selectedDate } = this.data
      const days: CalendarDay[] = []
      const firstDay = new Date(currentYear, currentMonth - 1, 1)
      const startDow = firstDay.getDay() // 0=Sun
      // 转换为周一起始: Mon=0, Tue=1, ..., Sun=6
      const startIdx = startDow === 0 ? 6 : startDow - 1
      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
      const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate()

      // 上月填充
      for (let i = startIdx - 1; i >= 0; i--) {
        const d = prevMonthDays - i
        const date = fmtDate(new Date(currentYear, currentMonth - 2, d))
        days.push({ date, day: d, isToday: date === today, isSelected: date === selectedDate, isCurrentMonth: false, hasPlan: false })
      }

      // 当月
      for (let d = 1; d <= daysInMonth; d++) {
        const date = fmtDate(new Date(currentYear, currentMonth - 1, d))
        days.push({ date, day: d, isToday: date === today, isSelected: date === selectedDate, isCurrentMonth: true, hasPlan: false })
      }

      // 下月填充 - 凑满 42 格
      const remaining = 42 - days.length
      for (let d = 1; d <= remaining; d++) {
        const date = fmtDate(new Date(currentYear, currentMonth, d))
        days.push({ date, day: d, isToday: date === today, isSelected: date === selectedDate, isCurrentMonth: false, hasPlan: false })
      }

      this.setData({ calendarDays: days })
    },

    // ====== 月份切换 ======
    prevMonth() {
      let { currentYear, currentMonth } = this.data
      if (currentMonth === 1) {
        currentYear--
        currentMonth = 12
      } else {
        currentMonth--
      }
      this.setData({ currentYear, currentMonth })
      this.buildCalendar()
      this.loadMonthPlans()
    },

    nextMonth() {
      let { currentYear, currentMonth } = this.data
      if (currentMonth === 12) {
        currentYear++
        currentMonth = 1
      } else {
        currentMonth++
      }
      this.setData({ currentYear, currentMonth })
      this.buildCalendar()
      this.loadMonthPlans()
    },

    // ====== 日期选择 ======
    onDateTap(e: any) {
      const date = e.currentTarget.dataset.date
      if (!date) return
      // 点击非当月日期 → 切换月份
      const [y, m] = date.split('-').map(Number)
      if (y !== this.data.currentYear || m !== this.data.currentMonth) {
        this.setData({ currentYear: y, currentMonth: m, selectedDate: date })
        this.buildCalendar()
        this.loadMonthPlans()
        this.loadDateDishes()
        return
      }
      this.setData({ selectedDate: date })
      // 只更新选中状态，不重建日历（避免丢失 hasPlan）
      this.setData({
        calendarDays: this.data.calendarDays.map(d => ({ ...d, isSelected: d.date === date })),
      })
      this.loadDateDishes()
    },

    // ====== 加载计划 ======
    async loadMonthPlans() {
      const gid = wx.getStorageSync('currentGroupId') || ''
      if (!gid) return
      const { currentYear, currentMonth } = this.data
      const start = fmtDate(new Date(currentYear, currentMonth - 1, 1))
      const end = fmtDate(new Date(currentYear, currentMonth, 0))
      try {
        const res = await db.collection('plans')
          .where({ groupId: gid, date: _.gte(start).and(_.lte(end)) })
          .limit(100)
          .get()
        const plans = (res.data || []) as Plan[]
        const dateSet = new Set(plans.map(p => p.date))
        const days = this.data.calendarDays.map(d => ({
          ...d,
          hasPlan: dateSet.has(d.date),
        }))
        this.setData({ calendarDays: days })
      } catch (e) {
        console.error(e)
      }
    },

    async loadDateDishes() {
      const gid = wx.getStorageSync('currentGroupId') || ''
      if (!gid) return
      this.setData({ dishesLoading: true })
      try {
        const res = await db.collection('plans')
          .where({ groupId: gid, date: this.data.selectedDate })
          .get()
        const plans = (res.data || []) as Plan[]
        const dishIds = [...new Set(plans.map(p => p.dishId))]
        if (dishIds.length === 0) {
          this.setData({ dateDishes: [] })
          return
        }
        const dishRes = await db.collection('dishes')
          .where({ _id: _.in(dishIds) })
          .get()
        const dishMap: Record<string, Dish> = {}
        for (const d of dishRes.data) {
          dishMap[d._id] = d as Dish
        }
        const dateDishes = plans
          .filter(p => dishMap[p.dishId])
          .map(p => ({ planId: p._id, dish: dishMap[p.dishId], partnerIds: (p as any).partnerIds || [], mealType: (p as any).mealType || '', reminderEnabled: !!(p as any).reminderEnabled }))
        // cloud:// 图片转为可访问的临时 HTTPS URL（通过云函数）
        const allFileIds: string[] = []
        for (const item of dateDishes) {
          if (item.dish.images) {
            for (const img of item.dish.images) {
              if (img && img.startsWith('cloud://')) allFileIds.push(img)
            }
          }
          if (item.dish.imageUrl && item.dish.imageUrl.startsWith('cloud://')) allFileIds.push(item.dish.imageUrl)
        }
        if (allFileIds.length > 0) {
          try {
            const imgRes = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIds: allFileIds } })
            const urlMap = (imgRes.result as any)?.urlMap || {}
            for (const item of dateDishes) {
              if (item.dish.images) {
                item.dish.images = item.dish.images.map((img: string) => urlMap[img] || img)
              }
              if (item.dish.imageUrl && urlMap[item.dish.imageUrl]) item.dish.imageUrl = urlMap[item.dish.imageUrl]
            }
          } catch (e) { console.error('获取图片URL失败', e) }
        }
        this.setData({ dateDishes, mealFilter: '' })
        this.applyMealFilter()
      } catch (e) {
        console.error(e)
      } finally {
        this.setData({ dishesLoading: false })
      }
    },

    // ====== 订阅消息（单菜品铃铛） ======
    onReminderBell(e: any) {
      const planId = e.currentTarget.dataset.id
      const idx = e.currentTarget.dataset.index
      const item = this.data.filteredDateDishes[idx]
      if (!item) return

      if (item.reminderEnabled) {
        wx.showModal({
          title: '取消提醒',
          content: '确认取消今晚该菜品的用餐提醒？',
          confirmColor: '#e74c3c',
          success: (res: any) => {
            if (res.confirm) this.clearReminderDirect(planId)
          },
        })
      } else {
        wx.requestSubscribeMessage({
          tmplIds: [this.data.subscribeTmplId],
          success: (res: any) => {
            if (res[this.data.subscribeTmplId] === 'accept') {
              this.setReminderDirect(planId)
              wx.showToast({ title: '今晚0:00提醒', icon: 'success' })
            }
          },
        })
      }
    },

    async setReminderDirect(planId: string) {
      const date = this.data.selectedDate
      const openid = app.globalData.openid
      // 先清空该用户当天所有提醒
      await db.collection('plans').where({ date, createdBy: openid }).update({
        data: { reminderEnabled: false },
      })
      // 再设置选中的
      await db.collection('plans').doc(planId).update({
        data: { reminderEnabled: true },
      })
      this.refreshReminderState()
    },

    async clearReminderDirect(planId: string) {
      await db.collection('plans').doc(planId).update({
        data: { reminderEnabled: false },
      })
      this.refreshReminderState()
    },

    async refreshReminderState() {
      const gid = wx.getStorageSync('currentGroupId') || ''
      if (!gid) return
      try {
        const res = await db.collection('plans')
          .where({ groupId: gid, date: this.data.selectedDate })
          .get()
        const plans = res.data || []
        const reminderMap: Record<string, boolean> = {}
        for (const p of plans) {
          reminderMap[p._id] = !!(p as any).reminderEnabled
        }
        const dateDishes = this.data.dateDishes.map(d => ({
          ...d,
          reminderEnabled: !!reminderMap[d.planId],
        }))
        this.setData({ dateDishes })
        this.applyMealFilter()
      } catch (e) {
        console.error('refreshReminderState error', e)
      }
    },

    // ====== 吃货计划弹窗 ======
    openPlanPopup() {
      this.setData({ showPlanPopup: true, planStep: 0, planDate: this.data.selectedDate, planDishSearch: '', planCatFilter: '', selectedDishIds: [], selectedMealType: '', eatAlone: true, selectedPartnerIds: [], partners: [] })
    },

    onPlanDateChange(e: any) {
      this.setData({ planDate: e.detail.value })
    },

    onSelectTomorrow() {
      this.setData({ planDate: this.data.tomorrow })
    },

    async goStep1() {
      this.setData({ planStep: 1, dishesLoading: true })
      await this.loadAllDishes()
      this.setData({ dishesLoading: false })
    },

    async loadAllDishes() {
      const gid = wx.getStorageSync('currentGroupId') || ''
      if (!gid) return
      try {
        // 加载分类
        const catRes = await db.collection('categories')
          .where({ groupId: gid, level: 1, parentId: null })
          .orderBy('sort', 'asc')
          .limit(100)
          .get()
        this.setData({ categories1: catRes.data as { _id: string; name: string }[] })

        // 建立 L1 → 所有关联 categoryId 的映射（L1 + 其下 L2）
        const l1ToIds: Record<string, string[]> = {}
        for (const c1 of catRes.data) {
          l1ToIds[c1._id] = [c1._id]
        }
        const l2Res = await db.collection('categories')
          .where({ groupId: gid, level: 2 })
          .limit(100)
          .get()
        for (const l2 of l2Res.data) {
          if (l2.parentId && l1ToIds[l2.parentId]) {
            l1ToIds[l2.parentId].push(l2._id)
          }
        }
        ;(this as any)._l1ToIds = l1ToIds

        // 加载所有菜品
        const dishRes = await db.collection('dishes')
          .where({ groupId: gid })
          .get()
        const allDishes = dishRes.data as Dish[]
        // cloud:// 图片转为可访问的临时 HTTPS URL
        const allFileIds: string[] = []
        for (const d of allDishes) {
          if (d.images) {
            for (const img of d.images) {
              if (img && img.startsWith('cloud://')) allFileIds.push(img)
            }
          }
          if (d.imageUrl && d.imageUrl.startsWith('cloud://')) allFileIds.push(d.imageUrl)
        }
        if (allFileIds.length > 0) {
          try {
            const imgRes = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIds: allFileIds } })
            const urlMap = (imgRes.result as any)?.urlMap || {}
            for (const d of allDishes) {
              if (d.images) {
                d.images = d.images.map((img: string) => urlMap[img] || img)
              }
              if (d.imageUrl && urlMap[d.imageUrl]) d.imageUrl = urlMap[d.imageUrl]
            }
          } catch (e) { console.error('获取图片URL失败', e) }
        }
        this.setData({ allDishes })
        this.applyDishFilter()
      } catch (e) {
        console.error(e)
      }
    },

    applyDishFilter() {
      const { allDishes, planDishSearch, planCatFilter, selectedDishIds } = this.data
      let list = allDishes
      if (planCatFilter) {
        const l1ToIds = (this as any)._l1ToIds as Record<string, string[]> | undefined
        const catIds = l1ToIds?.[planCatFilter] || [planCatFilter]
        list = list.filter(d => catIds.includes(d.categoryId))
      }
      if (planDishSearch) {
        const kw = planDishSearch.toLowerCase()
        list = list.filter(d => d.name.toLowerCase().includes(kw))
      }
      const selectedSet = new Set(selectedDishIds)
      const filtered = list.map(d => ({ ...d, _checked: selectedSet.has(d._id) }))
      this.setData({ filteredDishes: filtered })
    },

    syncCheckedState() {
      const selectedSet = new Set(this.data.selectedDishIds)
      const filtered = this.data.filteredDishes.map((d: any) => ({ ...d, _checked: selectedSet.has(d._id) }))
      this.setData({ filteredDishes: filtered })
    },

    onPlanDishSearch(e: any) {
      this.setData({ planDishSearch: e.detail.value })
      clearTimeout(this._searchTimer)
      this._searchTimer = setTimeout(() => this.applyDishFilter(), 200)
    },

    onClearSearch() {
      this.setData({ planDishSearch: '' })
      this.applyDishFilter()
    },

    onPlanCatFilter(e: any) {
      const id = e.currentTarget.dataset.id || ''
      this.setData({ planCatFilter: id })
      this.applyDishFilter()
    },

    toggleDishSelect(e: any) {
      const id = e.currentTarget.dataset.id
      const selected = new Set(this.data.selectedDishIds)
      if (selected.has(id)) {
        selected.delete(id)
      } else {
        selected.add(id)
      }
      this.setData({ selectedDishIds: [...selected] })
      this.syncCheckedState()
    },

    // ====== Step 2: 餐次选择 ======
    goStep2() {
      this.setData({ planStep: 2 })
    },

    selectMealType(e: any) {
      this.setData({ selectedMealType: e.currentTarget.dataset.value })
    },

    // ====== Step 3: 搭档选择 ======
    async goStep3() {
      if (!this.data.selectedMealType) {
        wx.showToast({ title: '请选择餐次', icon: 'none' })
        return
      }
      const gid = wx.getStorageSync('currentGroupId') || ''
      const planDate = this.data.planDate
      if (!gid || !planDate) return
      this.setData({ planStep: 3, dishesLoading: true })
      try {
        const groupRes = await db.collection('groups').doc(gid).get()
        const group: any = groupRes.data
        const fallbackMap: Record<string, { nickName: string; avatarUrl: string }> = {}
        for (const m of (group?.members || [])) {
          fallbackMap[m.openid] = { nickName: m.nickName, avatarUrl: m.avatarUrl }
        }
        const otherIds = (group?.memberIds || []).filter((id: string) => id !== app.globalData.openid)
        // 云函数统一查询（头像转为可访问的 HTTPS URL）
        if (otherIds.length > 0) {
          const res = await wx.cloud.callFunction({ name: 'getMemberInfos', data: { openids: otherIds } })
          const infos = (res.result as any)?.list || []
          for (const info of infos) {
          fallbackMap[info.openid] = { nickName: info.nickName || fallbackMap[info.openid]?.nickName || '', avatarUrl: info.avatarUrl || fallbackMap[info.openid]?.avatarUrl || '' }
          }
        }
        const partners = otherIds.map((id: string) => ({ openid: id, ...(fallbackMap[id] || { nickName: '', avatarUrl: '' }) }))
        this.setData({ partners, dishesLoading: false })
      } catch (e) {
        console.error('加载搭档失败', e)
        this.setData({ dishesLoading: false })
      }
    },

    backToStep1() {
      this.setData({ planStep: 1 })
    },

    backToStep2() {
      this.setData({ planStep: 2, eatAlone: true, selectedPartnerIds: [] })
    },

    toggleEatMode(e: any) {
      const mode = e.currentTarget.dataset.mode // 'alone' | 'multi'
      const partners = this.data.partners.map((p: any) => ({ ...p, _checked: false }))
      this.setData({ eatAlone: mode === 'alone', selectedPartnerIds: [], partners })
    },

    togglePartnerSelect(e: any) {
      const id = e.currentTarget.dataset.id
      const selected = new Set(this.data.selectedPartnerIds)
      if (selected.has(id)) {
        selected.delete(id)
      } else {
        selected.add(id)
      }
      const selectedIds = [...selected]
      const partners = this.data.partners.map((p: any) => ({ ...p, _checked: selectedIds.indexOf(p.openid) > -1 }))
      this.setData({ selectedPartnerIds: selectedIds, partners })
    },

    async confirmPlan() {
      if (this.data.selectedDishIds.length === 0 || this.data.planSaving) return
      const gid = wx.getStorageSync('currentGroupId') || ''
      if (!gid) {
        wx.showToast({ title: '请先选择分组', icon: 'none' })
        return
      }
      const { planDate, selectedDishIds, selectedMealType, eatAlone, selectedPartnerIds } = this.data
      if (!planDate) {
        wx.showToast({ title: '请选择日期', icon: 'none' })
        return
      }
      this.setData({ planSaving: true })
      const createdByName = app.globalData.userInfo?.nickName || ''
      const partnerIds = eatAlone ? [] : selectedPartnerIds
      try {
        await Promise.all(selectedDishIds.map((dishId: string) =>
          wx.cloud.callFunction({
            name: 'dishOp',
            data: {
              action: 'add',
              collection: 'plans',
              data: {
                groupId: gid,
                date: planDate,
                dishId,
                createdByName,
                partnerIds,
                mealType: selectedMealType,
              },
            },
          })
        ))
        this.setData({ showPlanPopup: false })
        wx.showToast({ title: '已添加', icon: 'success' })
        this.loadMonthPlans()
        if (planDate === this.data.selectedDate) {
          this.loadDateDishes()
        }
      } catch (e) {
        console.error('添加计划失败', e)
        const msg = (e as any).errMsg || (e as any).message || String(e)
        wx.showToast({ title: '添加失败: ' + msg, icon: 'none', duration: 3000 })
      } finally {
        this.setData({ planSaving: false })
      }
    },

    closePlanPopup() {
      this.setData({ showPlanPopup: false })
    },

    // 无匹配菜品时跳转新增
    goAddDish() {
      wx.setStorageSync('planPopupRestore', {
        planStep: this.data.planStep,
        planDate: this.data.planDate,
        planCatFilter: this.data.planCatFilter,
      })
      wx.removeStorageSync('editDishId')
      wx.navigateTo({ url: '/pages/dish/edit/edit' })
    },

    onMealFilter(e: any) {
      const value = e.currentTarget.dataset.value || ''
      this.setData({ mealFilter: value })
      this.applyMealFilter()
    },

    applyMealFilter() {
      const { dateDishes, mealFilter } = this.data
      const filtered = mealFilter ? dateDishes.filter(d => d.mealType === mealFilter) : dateDishes
      this.setData({ filteredDateDishes: filtered })
    },

    // ====== 菜品详情 ======
    goDishDetail(e: any) {
      const id = e.currentTarget.dataset.id
      const dish = this.data.dateDishes.find((d: any) => d.dish._id === id || d.planId === id)
      wx.setStorageSync('detailDishId', dish?.dish._id || id)
      wx.setStorageSync('detailFrom', 'calendar')
      wx.setStorageSync('detailPlanDate', this.data.selectedDate)
      wx.setStorageSync('detailMealType', dish?.mealType || '')
      wx.navigateTo({ url: '/pages/dish/detail/detail' })
    },

    // ====== 删除计划 ======
    openPlanDelete(e: any) {
      this.setData({ showDeleteDialog: true, deletePlanId: e.currentTarget.dataset.id, planDeleting: false })
    },
    closeDeleteDialog() {
      this.setData({ showDeleteDialog: false, deletePlanId: '', planDeleting: false })
    },
    async confirmDeletePlan() {
      if (this.data.planDeleting) return
      this.setData({ planDeleting: true })
      try {
        await db.collection('plans').doc(this.data.deletePlanId).remove()
        this.setData({ showDeleteDialog: false, deletePlanId: '' })
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadMonthPlans()
        this.loadDateDishes()
      } catch (e) {
        console.error('删除计划失败', e)
        wx.showToast({ title: '删除失败', icon: 'none' })
      } finally {
        this.setData({ planDeleting: false })
      }
    },

    // ====== 图片预览 ======
    previewImage(e: any) {
      const idx = e.currentTarget.dataset.index
      const images = e.currentTarget.dataset.images
      if (images && images.length > 0) {
        wx.previewImage({ current: images[idx] || images[0], urls: images })
      }
    },
  },
})
